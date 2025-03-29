package speechfunctioncaller;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.concurrent.*;
import java.io.*;
import javax.sound.sampled.*;
import java.nio.file.*;
import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.models.*;
import com.azure.core.credential.AzureKeyCredential;
import com.google.gson.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.nio.ByteBuffer;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * Transcriber class handles audio transcription using Azure's OpenAI Whisper API.
 * Purpose:
 * - Collects audio chunks from frontend
 * - Assembles chunks in correct sequences
 * - Converts chunks to appropriate audio format
 * - Sends correct format to Azure's API for transcription
 * 
 * NOTE: Currently limited to OpenAI's Whisper on an AZURE server.
 *
 * Singleton pattern: as there ever only needs to be one instance and we have global states 
 */
public class Transcriber {
    // Azure credentials
    private String ENDPOINT = "";
    private String TOKEN = "";
    private String MODEL = "";

    // Azure OpenAI client instance for API communication
    private OpenAIClient client;

    private static final int SAMPLE_RATE = 16000; //  Sample rate for audio processing (16kHz as per Whisper specifications (https://arxiv.org/pdf/2212.04356 "All audio is re-sampled to 16,000 Hz, ..."))
    private static final TreeMap<String, String> base64AudioChunks = new TreeMap<>((a, b) -> {  // Storage for audio chunks before processing { Date.now()-i : Base64 encoded audio data }
        // Split timestamps into components
        String[] partsA = a.split("-");
        String[] partsB = b.split("-");
        
        // Compare timestamps first
        long timestampA = Long.parseLong(partsA[0]);
        long timestampB = Long.parseLong(partsB[0]);
        
        if (timestampA != timestampB) {
            return Long.compare(timestampA, timestampB);
        }
        
        // If timestamps are equal, compare sequence numbers
        int seqA = Integer.parseInt(partsA[1]);
        int seqB = Integer.parseInt(partsB[1]);
        return Integer.compare(seqA, seqB);
    });
    
    private final ByteArrayOutputStream websocketAudioBuffer = new ByteArrayOutputStream();
    
    // Active WebSocket sessions
    private final Set<WebSocketSession> activeSessions = ConcurrentHashMap.newKeySet();
    
    // Audio format specification for processing
    private AudioFormat audioFormat;

    private String currentTranscription = "";
    private String previousTranscription = ""; // avoid sending duplicates by keeping track of previous transcription

    private ExecutorService transcriptionExecutor = Executors.newSingleThreadExecutor();
    private Future<?> currentTranscriptionTask; // Tracks the currently running transcription task and prevents starting new tasks while one is still in progress.

    private final Object transcriptionLock = new Object();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
    private ScheduledFuture<?> transcriptionTimer;
    private ScheduledFuture<?> maxTimeoutTimer;
    private volatile boolean newDataAvailable = false;

    // Timestamp of last audio data addition (any source)
    private long lastDataAddedTimestamp = 0;

    // Timestamp of first audio data addition since last transcription
    private long firstDataAddedTimestamp = 0;

    private static final int SILENCE_TIMEOUT_SECONDS = 3;
    private static final int MAX_AUDIO_TIMEOUT_SECONDS = 15;

    // Atomic integer to track transcription ID for logging
    private static final AtomicInteger transcriptionCounter = new AtomicInteger(0);

    /**
     * Base64 audio chunk with metadata
     */
    static class AudioChunk {
        public String sequence; // Sequence number for ordering
        public String data; // Base64 encoded audio data
        public boolean end; // Flag indicating end of audio stream
    }

    /**
     * Initializes Azure credentials and establishes connection to the API
     * Must be called before attempting any transcription operations
     *
     * @param endpoint Azure OpenAI API endpoint URL
     * @param token Azure OpenAI API authentication token
     * @param model Azure OpenAI model identifier
     */
    public void setCredentials(String endpoint, String token, String model) {
        this.ENDPOINT = endpoint;
        this.TOKEN = token;
        this.MODEL = model;

        this.client = new OpenAIClientBuilder()
            .credential(new AzureKeyCredential(TOKEN))
            .endpoint(ENDPOINT)
            .buildClient();
    }

    /**
     * Register a WebSocket session to receive transcription updates
     * 
     * @param session WebSocket session to register
     */
    public void registerWebSocketSession(WebSocketSession session) {
        if (session != null && session.isOpen()) {
            activeSessions.add(session);
            System.out.println("WebSocket session registered: " + session.getId());
        }
    }

    /**
     * Unregister a WebSocket session
     * 
     * @param session WebSocket session to unregister
     */
    public void unregisterWebSocketSession(WebSocketSession session) {
        activeSessions.remove(session);
        System.out.println("WebSocket session unregistered: " + session.getId());
    }


    /**
     * Adds a chunk of base64 encoded audio data to the processing queue
     * Expects JSON-formatted chunk data containing sequence number and audio data
     *
     * @param chunkData JSON string containing audio chunk information
     */
    public void addBase64Data(String chunkData) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            AudioChunk chunk = mapper.readValue(chunkData, AudioChunk.class);

            synchronized (transcriptionLock) {
                base64AudioChunks.put(chunk.sequence, chunk.data);
                handleNewDataAdded();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    
    /**
     * Adds raw binary audio data from websocket to the processing buffer
     *
     * @param audioData Raw binary audio data
     */
    public void addWebsocketData(byte[] audioData) {
        synchronized (transcriptionLock) {
            try {
                websocketAudioBuffer.write(audioData);
                handleNewDataAdded();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    /**
     * Common handler for when new audio data is added from any source
     * Sets up a timer to trigger transcription after a period of inactivity
     */
    private void handleNewDataAdded() {
        long currentTime = System.currentTimeMillis();
        newDataAvailable = true;
        lastDataAddedTimestamp = currentTime;
        
        // Record the timestamp of the first data chunk if this is the first data since last transcription
        if (firstDataAddedTimestamp == 0) {
            firstDataAddedTimestamp = currentTime;
            
            // Start the max timeout timer when we first receive data
            if (maxTimeoutTimer != null && !maxTimeoutTimer.isDone()) {
                maxTimeoutTimer.cancel(false);
            }
            
            maxTimeoutTimer = scheduler.schedule(() -> {
                synchronized (transcriptionLock) {
                    System.out.println("Max timeout of " + MAX_AUDIO_TIMEOUT_SECONDS + " seconds reached. Forcing transcription.");
                    if (hasAudioData() && (currentTranscriptionTask == null || currentTranscriptionTask.isDone())) {
                        newDataAvailable = false;
                        currentTranscriptionTask = transcriptionExecutor.submit(this::startTranscription);
                    }
                }
            }, MAX_AUDIO_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }
        
        // Reset silence timer
        if (transcriptionTimer != null && !transcriptionTimer.isDone()) {
            transcriptionTimer.cancel(false);
        }

        transcriptionTimer = scheduler.schedule(() -> {
            synchronized (transcriptionLock) {
                // Check if we've received any new data since the timer was scheduled
                long timeSinceLastData = System.currentTimeMillis() - lastDataAddedTimestamp;
                if (timeSinceLastData < SILENCE_TIMEOUT_SECONDS * 1000) {
                    // Data was added since timer was scheduled => reschedule
                    handleNewDataAdded();
                    return;
                }
                
                if (hasAudioData() && (currentTranscriptionTask == null || currentTranscriptionTask.isDone())) {
                    System.out.println("Silence threshold of " + SILENCE_TIMEOUT_SECONDS + " seconds reached. Starting transcription.");
                    newDataAvailable = false;
                    currentTranscriptionTask = transcriptionExecutor.submit(this::startTranscription);
                }
            }
        }, SILENCE_TIMEOUT_SECONDS, TimeUnit.SECONDS); // Wait for silence before transcribing
    }

    /**
     * Checks if there's any audio data available for transcription
     */
    private boolean hasAudioData() {
        return !base64AudioChunks.isEmpty() || websocketAudioBuffer.size() > 0;
    }

        /**
     * Starts the transcription process by gathering all available audio data
     */
    private void startTranscription() {
        long startTime = System.currentTimeMillis();
        int transcriptionId = transcriptionCounter.incrementAndGet(); // Generate unique ID for this transcription

        System.out.println("Starting transcription... [ID: " + transcriptionId + "]");
        
        try {
            ByteArrayOutputStream combinedBuffer = new ByteArrayOutputStream();

            // Reset transcription timers
            if (transcriptionTimer != null && !transcriptionTimer.isDone()) {
                transcriptionTimer.cancel(false);
            }
            
            if (maxTimeoutTimer != null && !maxTimeoutTimer.isDone()) {
                maxTimeoutTimer.cancel(false);
            }
            
            // Reset the timestamp of first data
            firstDataAddedTimestamp = 0;
            
            synchronized (transcriptionLock) {
                if (!hasAudioData()) {
                    return;
                }

                // Process base64 encoded chunks if any
                if (!base64AudioChunks.isEmpty()) {
                    System.out.println("Processing " + base64AudioChunks.size() + " base64 audio chunks");
                    
                    for (Map.Entry<String, String> entry : base64AudioChunks.entrySet()) {
                        try {
                            // Process each chunk individually
                            byte[] chunkBytes = Base64.getDecoder().decode(entry.getValue());
                            combinedBuffer.write(chunkBytes);
                        } catch (IllegalArgumentException e) {
                            System.err.println("Error decoding chunk " + entry.getKey() + ": " + e.getMessage());
                            // Continue with next chunk instead of failing completely
                            continue;
                        }
                    }
                    
                    // Clear processed base64 chunks to only transcribe new (if desired just uncomment below)
                    // base64AudioChunks.clear();
                }
                
                // Add websocket audio data if any
                if (websocketAudioBuffer.size() > 0) {
                    System.out.println("Adding " + websocketAudioBuffer.size() + " bytes from websocket buffer");
                    combinedBuffer.write(websocketAudioBuffer.toByteArray());
                    // Clear the websocket buffer chunks to only transcribe new (if desired just uncomment below)
                    // websocketAudioBuffer.reset(); 
                }
            }
            
            // Get the complete audio data
            byte[] audioBytes = combinedBuffer.toByteArray();
            System.out.printf("Final audio size: %d bytes%n", audioBytes.length);

            // Only proceed if we have audio data
            if (audioBytes.length > 0) {
                transcribeAudio(audioBytes, transcriptionId);
            }

            System.out.printf("Total transcription process time: %dms%n", System.currentTimeMillis() - startTime);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    /**
     * Processes all collected audio chunks and performs transcription
     *
     * @return JSON object containing status (true: ongoing transcription, false: no ongoing transcription) and transcription
     */
    public String transcribe() {
        JsonObject responseObject = new JsonObject();

        if (currentTranscriptionTask != null && !currentTranscriptionTask.isDone()) {
            responseObject.addProperty("status", true);
            responseObject.addProperty("transcription", currentTranscription);
            return escapeJsonString(responseObject.toString());
        }

        responseObject.addProperty("status", false);
        responseObject.addProperty("transcription", currentTranscription);
        return escapeJsonString(responseObject.toString());
    }

    /**
     * Escapes special characters in JSON strings
     * Necessary for nested JSON responses to prevent interference with outer JSON structure
     *
     * @param input Raw JSON string
     * @return Escaped JSON string
     */
    private String escapeJsonString(String input) {
        return input.replace("\"", "\\\"")
                   .replace("\n", "\\n")
                   .replace("\r", "\\r")
                   .replace("\t", "\\t");
    }

    /**
     * Unescapes special characters in JSON strings
     *
     * @param input Escaped JSON string
     * @return Unescaped JSON string
     */
    private String unescapeJsonString(String input) {
        return input.replace("\\\"", "\"")
                   .replace("\\n", "\n")
                   .replace("\\r", "\r")
                   .replace("\\t", "\t");
    }

    /**
     * Send transcription updates to all registered WebSocket sessions
     * 
     * @param transcription The transcription text to send
     */
    private void sendTranscriptionToWebSockets(String transcription) {
        // Only send if transcription has changed
        if (!transcription.equals(previousTranscription) && !activeSessions.isEmpty()) {
            previousTranscription = transcription;
            
            // Create JSON response
            JsonObject responseObject = new JsonObject();
            responseObject.addProperty("status", false); // Not processing anymore
            responseObject.addProperty("transcription", transcription);
            String jsonResponse = responseObject.toString();
            
            System.out.println("Sending transcription to " + activeSessions.size() + " WebSocket clients: " + transcription);
            
            // Send to all active sessions
            Set<WebSocketSession> closedSessions = new HashSet<>();
            for (WebSocketSession session : activeSessions) {
                try {
                    if (session.isOpen()) {
                        session.sendMessage(new TextMessage(jsonResponse));
                    } else {
                        closedSessions.add(session);
                    }
                } catch (IOException e) {
                    System.err.println("Error sending to WebSocket session " + session.getId() + ": " + e.getMessage());
                    closedSessions.add(session);
                }
            }
            
            // Clean up closed sessions
            for (WebSocketSession closedSession : closedSessions) {
                activeSessions.remove(closedSession);
            }
        }
    }

    /**
     * Core transcription method that processes audio data using Azure's Whisper API
     *
     * @param audioData Raw audio bytes to transcribe
     */
    public void transcribeAudio(byte[] audioData, int transcriptionId) {
        long startTime = System.currentTimeMillis();
        System.out.println("Starting audio transcription... [ID: " + transcriptionId + "]");

        this.audioFormat = new AudioFormat(SAMPLE_RATE, 16, 1, true, false);
        File tempFile = null;
        try {
            long fileStart = System.currentTimeMillis();
            tempFile = File.createTempFile("audio", ".wav");
            tempFile.deleteOnExit();
            System.out.printf("Temp file creation time: %dms%n", System.currentTimeMillis() - fileStart);

            long conversionStart = System.currentTimeMillis();
            AudioInputStream audioInputStream = new AudioInputStream(
                new ByteArrayInputStream(audioData),
                audioFormat,
                audioData.length / audioFormat.getFrameSize()
            );

            AudioSystem.write(audioInputStream, AudioFileFormat.Type.WAVE, tempFile);
            System.out.printf("Audio conversion time: %dms%n", System.currentTimeMillis() - conversionStart);

            long whisperStart = System.currentTimeMillis();
            AudioTranscriptionOptions transcriptionOptions = new AudioTranscriptionOptions(Files.readAllBytes(tempFile.toPath()))
                    .setResponseFormat(AudioTranscriptionFormat.JSON)
                    .setLanguage("");

            System.out.println("Calling Whisper API...");
            AudioTranscription transcription = client.getAudioTranscription(MODEL, tempFile.getName(), transcriptionOptions);
            String newTranscription = transcription.getText();
            System.out.printf("Whisper API call time: %dms%n", System.currentTimeMillis() - whisperStart);

            if (newTranscription != null && !newTranscription.trim().isEmpty()) {
                currentTranscription = newTranscription.trim();
                System.out.println("Transcription result [ID: " + transcriptionId + "]: " + newTranscription);

                // Send transcription to all registered WebSocket sessions
                sendTranscriptionToWebSockets(currentTranscription);
            }

            System.out.printf("Total audio processing and API time: %dms%n", System.currentTimeMillis() - startTime);
        } catch (com.azure.core.exception.HttpResponseException e) {
            if (e.getResponse().getStatusCode() == 429) {
                System.err.println("Rate limit exceeded. Retrying after the specified delay.");
                try {
                    int retryAfterSeconds = 57;
                    Thread.sleep(retryAfterSeconds * 1000);
                    transcribeAudio(audioData, transcriptionId); // Retry transcription
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            } else {
                e.printStackTrace();
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (tempFile != null) {
                tempFile.delete();
            }
        }
    }

    public void clearAll() {
        synchronized (transcriptionLock) { 
            // Cancel any pending transcription timer
            if (transcriptionTimer != null && !transcriptionTimer.isDone()) {
                transcriptionTimer.cancel(false);
            }
            
            // Cancel any ongoing transcription task
            if (currentTranscriptionTask != null && !currentTranscriptionTask.isDone()) {
                currentTranscriptionTask.cancel(true);
            }
            
            this.currentTranscription = "";
            this.previousTranscription = "";
            this.base64AudioChunks.clear();
            this.websocketAudioBuffer.reset();
            this.newDataAvailable = false;  // Reset the flag
        }
    }

    /**
     * Retrieves the current transcription result
     * @return String containing the current transcription
     */
    public String getCurrentTranscription() {
        return currentTranscription;
    }
}