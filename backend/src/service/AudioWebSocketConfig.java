package speechfunctioncaller.service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class AudioWebSocketConfig implements WebSocketConfigurer {
    
    @Bean
    public AudioWebSocketHandler audioWebSocketHandler() {
        return new AudioWebSocketHandler();
    }
    
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(audioWebSocketHandler(), "/audio-transcription")
                .setAllowedOrigins("*"); // For development unrestricted
    }
    
    // global configuration of WebSocket buffer sizes
    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(1024 * 1024); // 1MB
        container.setMaxBinaryMessageBufferSize(1024 * 1024); // 1MB
        container.setAsyncSendTimeout(30000L); // 30 seconds timeout for async operations
        return container;
    }
}