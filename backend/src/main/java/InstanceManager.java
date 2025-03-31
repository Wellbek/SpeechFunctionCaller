/**
* Author: Louis Wellmeyer
* Date: March 31, 2025
* License: CC BY
*/

package speechfunctioncaller;

import speechfunctioncaller.FunctionResolver;
import speechfunctioncaller.Transcriber;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * The InstanceManager class manages per-client instances of backend classes.
 * It ensures that each clients get dedicated instances of the required class while preventing duplicate creations.
 * Uses a thread-safe ConcurrentHashMap to store instances per client.
 */
public class InstanceManager {
    
    /**
     * Stores instances for each client. 
     * The outer map keys are client IDs, and the inner map stores class instances by class name.
     */
    private static final ConcurrentHashMap<String, ConcurrentHashMap<String, Object>> clientInstances = new ConcurrentHashMap<>();

    /**
     * Retrieves an instance of the specified class for a given client.
     * If an instance does not already exist, it creates one and stores it.
     *
     * @param clientId  The unique identifier for the client.
     * @param className The name of the class instance to retrieve (e.g., "FunctionResolver" or "Transcriber").
     * @return The instance of the requested class for the specified client.
     */
    public static Object getInstance(String clientId, String className) {
        // Ensure a map exists for the client
        clientInstances.putIfAbsent(clientId, new ConcurrentHashMap<>());

        // Retrieve or create the requested instance for the client
        ConcurrentHashMap<String, Object> instances = clientInstances.get(clientId);
        return instances.computeIfAbsent(className, k -> createNewInstance(className));
    }

    /**
     * Creates a new instance of the requested class.
     * 
     * @param className The name of the class to instantiate.
     * @return A new instance of the specified class.
     * @throws IllegalArgumentException If the className is unknown.
     * @throws RuntimeException If instance creation fails.
     */
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

    /**
     * Removes all instances associated with a specific client.
     * 
     * @param clientId The unique identifier of the client whose instances should be removed.
     */
    public static void removeClient(String clientId) {
        clientInstances.remove(clientId);
    }
}
