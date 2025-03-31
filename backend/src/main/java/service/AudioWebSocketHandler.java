/**
* Author: Louis Wellmeyer
* Date: March 31, 2025
* License: CC BY
*/

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

/**
 * WebSocket handler for managing binary audio data transmission.
 * This handler processes incoming audio byte streams and forwards them
 * to the transcription service while managing WebSocket sessions.
 */
public class AudioWebSocketHandler extends BinaryWebSocketHandler {
    
    private static final int BUFFER_SIZE_LIMIT = 1024 * 1024; // 1MB buffer limit for audio data
    
    /**
     * Handles incoming binary messages containing raw audio data.
     * 
     * @param session the WebSocket session from which the message originated
     * @param message the binary message containing audio data
     * @throws Exception if an error occurs while processing the message
     */
    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) throws Exception {
        ByteBuffer data = message.getPayload();

        // Reject oversized messages to prevent memory overflow
        if (data.remaining() > BUFFER_SIZE_LIMIT) {
            System.err.println("Received oversized message: " + data.remaining() + " bytes. Ignoring...");
            return;
        }

        // Extract audio data from the binary message
        byte[] audioData = new byte[data.remaining()];
        data.get(audioData);
        
        // Retrieve clientId from WebSocketSession's URI query parameters
        String query = session.getUri().getQuery(); // "clientId=xyz"
        Map<String, String> params = UriComponentsBuilder.fromUriString("?" + query).build().getQueryParams().toSingleValueMap();
        String clientId = params.get("clientId"); // "xyz"

        if (clientId == null || clientId.isEmpty()) {
            System.err.println("Client ID is missing. Cannot process audio data.");
            return; // Ignore messages without a valid clientId
        }
        
        // Forward the audio data to the transcriber instance belonging to the clientId
        Transcriber transcriber = (Transcriber) InstanceManager.getInstance(clientId, "Transcriber");
        transcriber.addWebsocketData(audioData);
        
        // Register the WebSocket session to allow responses when transcription is completed
        transcriber.registerWebSocketSession(session);
    }
    
    /**
     * Handles WebSocket connection establishment.
     * Increases buffer size limits to support large audio messages.
     * 
     * @param session the newly established WebSocket session
     * @throws Exception if an error occurs during connection setup
     */
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("WebSocket connection established: " + session.getId());
        // Increase buffer limits to handle larger audio messages
        session.setBinaryMessageSizeLimit(BUFFER_SIZE_LIMIT);
        session.setTextMessageSizeLimit(BUFFER_SIZE_LIMIT);
    }
    
    /**
     * Handles transport errors that occur during WebSocket communication.
     * 
     * @param session the affected WebSocket session
     * @param exception the error encountered during communication
     * @throws Exception if additional error handling is required
     */
    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        System.err.println("WebSocket transport error: " + exception.getMessage());
        exception.printStackTrace();
    }
}