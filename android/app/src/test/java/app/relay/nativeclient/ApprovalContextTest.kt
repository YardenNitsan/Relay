package app.relay.nativeclient

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ApprovalContextTest {
    private fun event(id: Int, type: String, data: String, task: String = "task") =
        JSONObject("""{"id":$id,"type":"$type","taskId":"$task","data":$data}""")
    @Test fun modelUsesProposalAgentAndEarlierRerouteOnly() {
        val approval = JSONObject("""{"taskId":"task","toolCallId":"call","tool":"file_write"}""")
        val events = listOf(
            event(1, "AGENT_STARTED", """{"agentId":"worker","modelId":"original"}"""),
            event(2, "MODEL_REROUTED", """{"agentId":"worker","to":"fallback"}"""),
            event(3, "TOOL_REQUESTED", """{"agentId":"worker","toolCallId":"call"}"""),
            event(4, "MODEL_REROUTED", """{"agentId":"worker","to":"later"}"""),
            event(2, "MODEL_REROUTED", """{"agentId":"worker","to":"other-task"}""", "other"))
        assertEquals("fallback", approvalModel(approval, events))
        assertEquals("Model not recorded", approvalModel(approval, events.filter { it.label("type") != "TOOL_REQUESTED" }))
    }
    @Test fun cloudConsentNamesTheRequestedExternalModel() {
        assertEquals("provider:model", approvalModel(JSONObject("""{"tool":"cloud_egress","arguments":{"model":"provider:model"}}"""), emptyList()))
    }
}
