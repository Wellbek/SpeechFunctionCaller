package speechfunctioncaller.service;

import java.nio.ByteBuffer;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.BinaryWebSocketHandler;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.util.UriComponentsBuilder;
import speechfunctioncaller.Transcriber;
import speechfunctioncaller.InstanceManager;

public class AudioWebSocketHandler extends BinaryWebSocketHandler {
    
    private static final int BUFFER_SIZE_LIMIT = 1024 * 1024; // 1MB buffer
    
    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        ByteBuffer data = message.getPayload();

        if (data.remaining() > BUFFER_SIZE_LIMIT) {
            System.err.println("Received oversized message: " + data.remaining() + " bytes. Ignoring...");
            return; // Do not process oversized messages
        }

        byte[] audioData = new byte[data.remaining()];
        data.get(audioData);
        
        // Retrieve clientId from WebSocketSession's URI query parameters
        String query = session.getUri().getQuery(); // "clientId=xyz"
        Map<String, String> params = UriComponentsBuilder.fromUriString("?" + query).build().getQueryParams().toSingleValueMap();
        String clientId = params.get("clientId"); // "xyz"

        if (clientId == null || clientId.isEmpty()) {
            System.err.println("Client ID is missing. Cannot process audio data.");
            return; // Handle missing clientId
        }
        
        // Add the audio data to the transcriber's buffer
        Transcriber transcriber = (Transcriber) InstanceManager.getInstance(clientId, "Transcriber");
        transcriber.addWebsocketData(audioData);
        
        // Store the WebSocket session for later use when transcription is ready
        transcriber.registerWebSocketSession(session);
    }
    
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("WebSocket connection established: " + session.getId());
        // Increase the session's text message buffer size limit
        session.setBinaryMessageSizeLimit(BUFFER_SIZE_LIMIT);
        session.setTextMessageSizeLimit(BUFFER_SIZE_LIMIT);
    }
    
    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        System.err.println("WebSocket transport error: " + exception.getMessage());
        exception.printStackTrace();
    }
}