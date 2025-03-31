/**
* Author: Louis Wellmeyer
* Date: March 31, 2025
* License: CC BY
*/

package speechfunctioncaller;

import java.lang.reflect.Method;
import speechfunctioncaller.InstanceManager;
import speechfunctioncaller.FunctionResolver;
import speechfunctioncaller.Transcriber;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

/**
 * DataProcessor class handles dynamic method invocation based on JSON input.
 * This class serves as a bridge between JSON-formatted functions and actual Java method execution.
 * Static class as we only need its functions and it doesn't have a state
 *
 * The class expects JSON input in the format:
 * {
 *   "class": "className"
 *   "function": "methodName",
 *   "parameters": [param1, param2, ...]
 * }
 */
public class DataProcessor {
    private static final Gson gson = new Gson();

    /**
     * Handles the JSON input, retrieves the corresponding instance, and executes the specified function.
     *
     * @param clientId Unique identifier for the client session, used to retrieve the correct instance of the backend classes.
     * @param data JSON-formatted string containing function information.
     * @return Result of the method invocation.
     * 
     * @throws IllegalArgumentException if input is invalid or required fields are missing.
     * @throws Exception if any error occurs during processing or method execution.
     */
    public static Object process(String clientId, String data) throws Exception {
        if (data == null || data == "") {
            throw new IllegalArgumentException("Input data cannot be null");
        }

        try {
            JsonObject jsonObject = gson.fromJson(data, JsonObject.class);

            // Validate required fields in the JSON input
            if (!jsonObject.has("class") || !jsonObject.has("function") || !jsonObject.has("parameters")) {
                throw new IllegalArgumentException("Missing required fields in input JSON");
            }

            String className = jsonObject.get("class").getAsString();
            String functionName = jsonObject.get("function").getAsString().replace("()", ""); // Remove parentheses from method name if they were provided
            Object[] parameters = gson.fromJson(jsonObject.get("parameters"), Object[].class);

            // Retrieve a client-specific instance using InstanceManager
            Object instance = InstanceManager.getInstance(clientId, className);

            if (instance == null) {
                throw new IllegalStateException("Failed to resolve instance for class: " + className);
            }

            // Use reflection to locate and invoke the requested method on the retrieved instance
            Method method = instance.getClass().getMethod(functionName, getParameterTypes(parameters));
            return method.invoke(instance, parameters);

        } catch (Exception e) {
            System.err.println("Error processing data: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Determines the parameter types for method invocation based on the actual parameters
     *
     * @param parameters Array of parameter objects
     * @return Class<?>[] Array of parameter types
     */
    private static Class<?>[] getParameterTypes(Object[] parameters) {
        Class<?>[] types = new Class<?>[parameters.length];
        for (int i = 0; i < parameters.length; i++) {
            types[i] = parameters[i] != null ? parameters[i].getClass() : Object.class; // if null just use Object.class as class
        }
        return types;
    }
}