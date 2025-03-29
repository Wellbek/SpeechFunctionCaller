package speechfunctioncaller;

import com.azure.ai.openai.OpenAIClient;
import com.azure.ai.openai.OpenAIClientBuilder;
import com.azure.ai.openai.models.*;
import com.azure.core.credential.AzureKeyCredential;
import com.azure.core.util.BinaryData;
import com.google.gson.*;
import java.util.*;
import umlp.backendrte.command.SimpleResult;
import java.util.regex.*;

/**
 * FunctionResolver class manages interactions with Azure OpenAI's function calling capabilities.
 * Purpose:
 * - Function definition management
 * - Context history tracking and compression
 * - JSON processing for function calls
 * 
 * NOTE: Currently limited to OpenAI's ChatCompletionsAPI on an AZURE server.
 *
 * Singleton pattern: as there ever only needs to be one instance and we have global states 
 */
public class FunctionResolver {

    private String ENDPOINT = "";
    private String TOKEN = "";
    private String MODEL = "";

    // Azure OpenAI client instance for API communication
    private OpenAIClient client;

    // Threshold for when to compress conversation history
    // Compression occurs when history size reaches COMPRESSION_THRESHOLD * 2 (prompt + answer)
    private static final int COMPRESSION_THRESHOLD = 3;

    // Stores the conversation history as a list of user messages up to the compression threshold
    private final List<ChatRequestUserMessage> contextHistory = new ArrayList<>();

    // Stores the compressed summary of previous conversations exceeding the compression threshold
    private String contextSummary = "";

    private String query = "";

    // List of available function definitions that can be called
    private List<ChatCompletionsToolDefinition> tools = new ArrayList<>();

    private static final Gson gson = new Gson();
    
    /**
     * Initializes Azure credentials and establishes connection to the API
     * Must be called before attempting any function calls
     *
     * @param endpoint Azure OpenAI API endpoint URL
     * @param token Azure OpenAI API authentication token
     * @param model Azure OpenAI model identifier
     */
    public void setCredentials(String endpoint, String token, String model) {
        this.ENDPOINT = endpoint;
        this.TOKEN = token;
        this.MODEL = model;

        // Initialize connection with Azure client
        this.client = new OpenAIClientBuilder()
            .credential(new AzureKeyCredential(TOKEN))
            .endpoint(ENDPOINT)
            .buildClient();
    }

    /**
     * Sets the current query to be processed
     * @param query The user's input query text
     */
    public void setQuery(String query) {
        this.query = query;    
    }

    /**
     * Clears all registered tools/functions
     */
    public void resetTools() {
        tools.clear();
    }

    /**
     * Checks if any tools/functions are registered
     * @return boolean indicating if tools are available
     */
    public boolean hasTools() {
        return !tools.isEmpty();
    }

    /**
     * Adds a new function definition to available tools
     * Parses JSON function definition and creates corresponding ChatCompletionsToolDefinition
     *
     * @param toolJSON JSON string containing function definition
     * 
     * @throws RuntimeException if parsing fails
     */
    public void addTool(String toolJSON) {
        try {
            // Unescape JSON string if needed (just to make sure, should work without tho)
            String unescapedToolJSON = unescapeJsonString(toolJSON);

            // Parse JSON and validate fields
            JsonObject jsonObject = gson.fromJson(unescapedToolJSON, JsonObject.class);
            if (!jsonObject.has("name") || !jsonObject.has("description") || !jsonObject.has("parameters")) {
                throw new IllegalArgumentException("Missing required fields in tool JSON");
            }

            // Extract function details
            String functionName = jsonObject.get("name").getAsString();
            String functionDescription = jsonObject.get("description").getAsString();
            JsonObject functionParameters = jsonObject.getAsJsonObject("parameters");
            String functionParametersString = gson.toJson(functionParameters);

            // Create and add new tool definition
            tools.add(new ChatCompletionsFunctionToolDefinition(
                new ChatCompletionsFunctionToolDefinitionFunction(functionName)
                    .setDescription(functionDescription)
                    .setParameters(BinaryData.fromString(functionParametersString))
            ));
        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Failed to parse tool JSON: " + toolJSON, e);
        }
    }

    /**
     * Main method for processing queries and resolving function calls
     *
     * @return Escaped JSON string containing either function calls or message response
     */
    public String resolveFunctions() {
        // Prepare chat messages with system context and history
        List<ChatRequestMessage> chatMessages = new ArrayList<>();
        chatMessages.add(new ChatRequestSystemMessage(
            "You are a helpful assistant for interacting with an HTML page to extract information and perform actions on various elements "
            + "(e.g., entering values in fields, clicking buttons, selecting dropdowns). For values, never add the unit. The unit is given by the HTML element names "
            + "(e.g., Voltage (V) => value in V). \n\n"
            + "IMPORTANT: Only use past context (previously set values or selections) when the query directly refers to them. "
            + "If the user does not mention past information, do NOT use it for new function calls."
        ));


        if (!contextSummary.isEmpty()) {
            chatMessages.add(new ChatRequestSystemMessage(
                "Use the previous context summary only if the query refers to it. " +
                "If the query does not mention past information, ignore it. " +
                "Context summary: " + contextSummary
            ));
        }

        // Add conversation history and current query
        chatMessages.addAll(contextHistory);
        chatMessages.add(new ChatRequestUserMessage(query));
        contextHistory.add(new ChatRequestUserMessage(query));

        // Configure and make API call
        ChatCompletionsOptions chatCompletionsOptions = new ChatCompletionsOptions(chatMessages);
        chatCompletionsOptions.setTools(tools);
        ChatCompletions chatCompletions = client.getChatCompletions(MODEL, chatCompletionsOptions);

        ChatChoice choice = chatCompletions.getChoices().get(0);
        
        // Handle function call response
        if (choice.getFinishReason() == CompletionsFinishReason.TOOL_CALLS) {
            try {
                // Build function calls response
                JsonObject responseObject = new JsonObject();
                responseObject.addProperty("type", "functions");

                JsonArray functionsArray = new JsonArray();
                for (ChatCompletionsToolCall toolCall : choice.getMessage().getToolCalls()) {
                    ChatCompletionsFunctionToolCall functionToolCall = (ChatCompletionsFunctionToolCall) toolCall;

                    JsonObject functionObject = new JsonObject();
                    functionObject.addProperty("name", functionToolCall.getFunction().getName());
                    JsonElement argsElement = JsonParser.parseString(functionToolCall.getFunction().getArguments());
                    functionObject.add("args", argsElement);

                    functionsArray.add(functionObject);
                }
                responseObject.add("functions", functionsArray);

                // Update context with LLM response
                String finalResponse = choice.getMessage().getContent();
                contextHistory.add(new ChatRequestUserMessage("For context, last LLM Response: " + finalResponse));

                // Check if context compression is needed
                if (contextHistory.size() >= COMPRESSION_THRESHOLD * 2) {
                    compressContext();
                }

                return escapeJsonString(responseObject.toString());
            } catch (Exception e) {
                // Handle errors in function call processing
                JsonObject errorObject = new JsonObject();
                errorObject.addProperty("status", "error");
                errorObject.addProperty("message", "Failed to process function calls: " + e.getMessage());
                return escapeJsonString(errorObject.toString());
            }
        }

        // Check if context compression is needed
        if (contextHistory.size() >= COMPRESSION_THRESHOLD * 2) {
            compressContext();
        }

        // Handle regular message response
        JsonObject messageObject = new JsonObject();
        messageObject.addProperty("type", "message");
        messageObject.addProperty("content", choice.getMessage().getContent());
        return escapeJsonString(messageObject.toString());
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
     * Compresses conversation history when it exceeds threshold
     * Creates a summary of key information to maintain context while reducing memory usage => less tokens, faster responses
     * Focuses specifically on car and battery information
     */
    private void compressContext() {
        // Prepare compression request
        List<ChatRequestMessage> compressionMessages = new ArrayList<>();
        compressionMessages.add(new ChatRequestSystemMessage(
            "Summarize the following conversation history in a concise way, focussing on the key data information."
            + "The summary should encompass ALL information about any changes and choices made for the key information in the past in order of time"
        ));

        // Build full context from existing summary and history
        StringBuilder fullContext = new StringBuilder();
        if (!contextSummary.isEmpty()) {
            fullContext.append("Previous context summary: ")
                .append(contextSummary)
                .append("\n\nNew messages:\n");
        }

        for (ChatRequestUserMessage message : contextHistory) {
            fullContext.append(message.getContent()).append("\n");
        }

        // Get compressed summary from API
        compressionMessages.add(new ChatRequestUserMessage(fullContext.toString()));
        ChatCompletionsOptions options = new ChatCompletionsOptions(compressionMessages);
        ChatCompletions completions = client.getChatCompletions(MODEL, options);

        // Update context with compressed summary
        contextSummary = completions.getChoices().get(0).getMessage().getContent();
        contextHistory.clear();
    }

    public void clearAll() {
        contextHistory.clear();
        contextSummary = "";
    }
}