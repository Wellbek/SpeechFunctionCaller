/**
* Author: Louis Wellmeyer
* Date: March 31, 2025
* License: CC BY
*/

package speechfunctioncaller.service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * Configuration class for setting up WebSocket communication in a Spring Boot application.
 * This WebSocket is specifically designed for transmitting raw audio bytes
 * between the transcription backend and the speech function caller frontend
 * for higher efficiency.
 */
@Configuration
@EnableWebSocket
public class AudioWebSocketConfig implements WebSocketConfigurer {
    
    /**
     * Defines and provides a WebSocket handler bean responsible for managing
     * audio data transmission.
     * 
     * @return an instance of AudioWebSocketHandler
     */
    @Bean
    public AudioWebSocketHandler audioWebSocketHandler() {
        return new AudioWebSocketHandler();
    }
    
    /**
     * Registers the WebSocket handler to handle connections at the specified endpoint.
     * The endpoint "/audio-transcription" is used for audio streaming.
     * 
     * @param registry WebSocketHandlerRegistry for registering handlers
     */
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(audioWebSocketHandler(), "/audio-transcription")
                .setAllowedOrigins("*"); // Allow all origins during development
    }
    
    /**
     * Configures global WebSocket settings such as buffer sizes and timeout limits.
     * 
     * @return a configured ServletServerContainerFactoryBean instance
     */
    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        
        // Set buffer size limits for handling large audio messages
        container.setMaxTextMessageBufferSize(1024 * 1024); // 1MB text message buffer
        container.setMaxBinaryMessageBufferSize(1024 * 1024); // 1MB binary message buffer for audio data
        
        // Define timeout for asynchronous message sending
        container.setAsyncSendTimeout(30000L); // 30 seconds timeout to prevent hanging connections
        
        return container;
    }
}
