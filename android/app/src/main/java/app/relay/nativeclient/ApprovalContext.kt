package app.relay.nativeclient

import org.json.JSONObject

/** Identity is derived from durable task events preceding this exact proposal. */
fun approvalModel(approval: JSONObject, events: List<JSONObject>): String {
    if (approval.label("tool") == "cloud_egress") return approval.optJSONObject("arguments")?.label("model", "Model not recorded") ?: "Model not recorded"
    val taskEvents = events.filter { it.label("taskId") == approval.label("taskId") }
    val request = taskEvents.firstOrNull { it.label("type") == "TOOL_REQUESTED" && it.optJSONObject("data")?.label("toolCallId") == approval.label("toolCallId") } ?: return "Model not recorded"
    val agent = request.optJSONObject("data")?.label("agentId")?.takeIf { it.isNotBlank() } ?: return "Model not recorded"
    val identity = taskEvents.filter {
        it.optLong("id") < request.optLong("id") && it.optJSONObject("data")?.label("agentId") == agent &&
            it.label("type") in listOf("AGENT_STARTED", "MODEL_REROUTED", "MODEL_CALL_COMPLETED")
    }.maxByOrNull { it.optLong("id") } ?: return "Model not recorded"
    return identity.optJSONObject("data")?.label(if (identity.label("type") == "MODEL_REROUTED") "to" else "modelId", "Model not recorded") ?: "Model not recorded"
}
