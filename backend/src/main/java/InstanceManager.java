package speechfunctioncaller;

import speechfunctioncaller.FunctionResolver;
import speechfunctioncaller.Transcriber;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * **Static** nested class InstanceManager that handles instance creation and management.
 */
public class InstanceManager {
    private static final ConcurrentHashMap<String, ConcurrentHashMap<String, Object>> clientInstances = new ConcurrentHashMap<>();

    public static Object getInstance(String clientId, String className) {
        clientInstances.putIfAbsent(clientId, new ConcurrentHashMap<>());
        ConcurrentHashMap<String, Object> instances = clientInstances.get(clientId);
        return instances.computeIfAbsent(className, k -> createNewInstance(className));
    }

    private static Object createNewInstance(String className) {
        try {
            switch (className) {
                case "FunctionResolver":
                    return new FunctionResolver();
                case "Transcriber":
                    return new Transcriber();
                default:
                    throw new IllegalArgumentException("Unknown class: " + className);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to create instance for " + className, e);
        }
    }

    public static void removeClient(String clientId) {
        clientInstances.remove(clientId);
    }
}