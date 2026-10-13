package app.relay.nativeclient

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID
import javax.net.ssl.SSLException

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.objects(key: String): List<JSONObject> = optJSONArray(key)?.objects() ?: emptyList()
fun JSONObject.label(key: String, fallback: String = ""): String = optString(key).takeUnless { it == "null" || it.isBlank() } ?: fallback
data class RelayUi(
    val busy: Boolean = false, val session: JSONObject? = null, val origin: String = "", val error: String? = null,
    val conversations: List<JSONObject> = emptyList(), val conversation: JSONObject? = null,
    val task: JSONObject? = null, val assistants: List<JSONObject> = emptyList(), val workspaces: List<JSONObject> = emptyList(),
    val files: List<JSONObject> = emptyList(), val file: JSONObject? = null, val filePath: String? = null,
    val models: List<JSONObject> = emptyList(), val selectedWorkspace: String? = null, val selectedAssistant: String? = null,
    val selectedModel: String? = null, val draft: String = "", val tab: String = "Chat", val stream: String = "Disconnected",
    val events: List<JSONObject> = emptyList(), val liveText: String = "", val uncertain: Boolean = false,
    val draftStatus: String = "", val attachment: AttachmentReview? = null, val notice: String? = null,
    val taskNotifications: Boolean = false, val canRetrySession: Boolean = false
)
data class AttachmentReview(val name: String, val bytes: Int, val document: Boolean, val workspaceId: String?, val workspaceName: String)
data class AttachmentTarget(val epoch: Long, val conversation: String)

class RelayViewModel(application: Application) : AndroidViewModel(application) {
    private val vault = SessionVault(application)
    private val sessionRecovery = SessionRecovery(vault::load, vault::clear)
    private val notifications = TaskNotifications(application)
    private var notificationBinding: TaskNotifications.Binding? = null
    private val draftRepository = DraftVault(application).repository
    private val mutable = MutableStateFlow(RelayUi())
    val state = mutable.asStateFlow()
    private var client: RelayClient? = null
    private var epoch = 0L
    private var actionJob: Job? = null
    private var streamJob: Job? = null
    private var refreshJob: Job? = null
    private var foreground = false
    private var cursor = 0L
    private var scope: String? = null
    private var liveCallId: String? = null
    private var pendingStart: Pair<String, JSONObject>? = null
    private val drafts = mutableMapOf<String, DraftRecord>()
    private var draftEpoch = 0L
    private var draftRevision = 0L
    private var preparedAttachment: PreparedAttachment? = null
    private var pendingAttachmentTarget: AttachmentTarget? = null
    private fun draftKey() = state.value.conversation?.optJSONObject("conversation")?.label("id") ?: "new"
    private fun update(change: (RelayUi) -> RelayUi) { mutable.value = change(mutable.value) }
    private fun valid(c: RelayClient, generation: Long) { if (c !== client || epoch != generation) throw CancellationException("Session changed") }
    private fun record(s: RelayUi = state.value) = DraftRecord(s.draft, s.selectedWorkspace, s.selectedAssistant, s.selectedModel, s.uncertain)
    private fun restored(s: RelayUi, value: DraftRecord) = s.copy(draft = value.text, selectedWorkspace = value.workspaceId,
        selectedAssistant = value.assistantId, selectedModel = value.modelId, uncertain = value.uncertain, draftStatus = "Draft saved on this device")
    private fun persistDraft() {
        if (state.value.session == null) return
        val id = draftKey(); val value = record(); drafts[id] = value
        val localEpoch = draftEpoch; val generation = epoch; val revision = ++draftRevision
        update { it.copy(draftStatus = "Saving draft…") }
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { draftRepository.save(localEpoch, id, revision, value) }
                if (generation == epoch && draftKey() == id && revision == draftRevision) update { it.copy(draftStatus = "Draft saved on this device") }
            } catch (_: Exception) {
                if (generation == epoch) update { it.copy(draftStatus = "Draft not saved", error = "The device could not save this draft securely. Keep the app open and try again before leaving.") }
            }
        }
    }
    private suspend fun loadDraft(id: String): DraftRecord {
        val localEpoch = draftEpoch
        return drafts[id] ?: withContext(Dispatchers.IO) { draftRepository.load(localEpoch, id) }
    }
    init {
        viewModelScope.launch {
            update { it.copy(busy = true) }
            val saved = withContext(Dispatchers.IO) { vault.load() }
            update { it.copy(busy = false) }
            if (saved != null) connect(saved.first, null, saved.second)
        }
    }
    fun connect(url: String, invitation: String?, saved: String? = null) {
        if (state.value.busy) return
        val origin = try { Protocol.origin(url) } catch (e: IllegalArgumentException) { update { it.copy(error = e.message) }; return }
        if (invitation != null && !Regex("^[A-Za-z0-9_-]{43}$").matches(invitation.trim())) { update { it.copy(error = "Enter the one-use invitation supplied by the host owner.") }; return }
        epoch++; actionJob?.cancel(); stopRealtime(); client?.close(); preparedAttachment = null; pendingAttachmentTarget = null; drafts.clear()
        notificationBinding = null
        if (invitation != null) notifications.clear()
        val c = RelayClient(origin, saved); client = c
        val generation = epoch
        update { RelayUi(busy = true, origin = origin) }
        actionJob = viewModelScope.launch {
            try {
                val session = c.session(invitation?.trim()); valid(c, generation)
                withContext(Dispatchers.IO) { vault.save(origin, c.storedCookie()) }; valid(c, generation)
                val binding = notifications.binding(origin, session.getJSONObject("user").getString("id"), c.storedCookie())
                notificationBinding = binding
                notifications.activate(binding)
                draftEpoch = draftRepository.activate(origin, session.getJSONObject("user").getString("id"))
                val draft = loadDraft("new"); valid(c, generation)
                update { it.copy(session = session, error = null, taskNotifications = notifications.enabled(binding)) }
                update { restored(it, draft) }
                refreshLists(c, generation)
                sessionRecovery.verified()
                startRealtime()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (epoch == generation) {
                    if (e is RelayError && e.status == 401) {
                        disconnect(false)
                        val deletionWarning = state.value.error
                        update { RelayUi(origin = origin, error = listOfNotNull(friendly(e), deletionWarning).joinToString(" ")) }
                    } else {
                        val canRetry = withContext(Dispatchers.IO) { sessionRecovery.failed(origin, e) }; valid(c, generation)
                        c.close(); client = null; notificationBinding = null; drafts.clear(); preparedAttachment = null; pendingAttachmentTarget = null
                        if (!canRetry) notifications.clear()
                        update { RelayUi(origin = origin, error = friendly(e), canRetrySession = canRetry) }
                    }
                }
            }
            finally { if (epoch == generation) update { it.copy(busy = false) } }
        }
    }
    fun retrySavedConnection() {
        if (state.value.busy || !state.value.canRetrySession) return
        val generation = epoch
        update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            val saved = withContext(Dispatchers.IO) { sessionRecovery.retry() }
            if (epoch != generation) return@launch
            update { it.copy(busy = false) }
            if (saved == null) update { RelayUi(origin = it.origin, error = "The saved connection is no longer available. Ask the owner for a new invitation.") }
            else connect(saved.first, null, saved.second)
        }
    }
    fun forgetSavedConnection() { if (!state.value.busy) disconnect(false) }
    private fun friendly(e: Exception): String = when (e) {
        is RelayError -> e.message ?: "The host refused this request."
        is SSLException -> "The HTTPS certificate is not trusted or does not match this host. Ask the owner to configure a valid LAN certificate."
        is java.net.SocketTimeoutException -> "The host did not respond in time. Check your LAN connection and refresh."
        is java.net.UnknownHostException, is java.net.ConnectException -> "The LAN host is unreachable. Check the address, Wi-Fi and host service."
        else -> "The connection or response could not be verified. Check the LAN host and refresh."
    }
    private fun handleFailure(e: Exception, c: RelayClient, generation: Long) {
        if (client !== c || epoch != generation) return
        if (e is RelayError && e.status == 401) {
            disconnect(false)
            update { it.copy(error = e.message) }
        } else update { it.copy(error = friendly(e)) }
    }
    private fun action(block: suspend (RelayClient, Long) -> Unit) {
        val c = client ?: return
        if (state.value.busy) return
        val generation = epoch
        update { it.copy(busy = true, error = null) }
        actionJob = viewModelScope.launch {
            try { block(c, generation) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { handleFailure(e, c, generation) }
            finally { if (epoch == generation) update { it.copy(busy = false) } }
        }
    }
    private suspend fun refreshLists(c: RelayClient, generation: Long) {
        val conversations = (c.json("/api/conversations") as JSONArray).objects(); valid(c, generation)
        update { it.copy(conversations = conversations) }
        val assistants = (c.json("/api/assistants") as JSONObject).objects("assistants"); valid(c, generation)
        val workspaces = (c.json("/api/workspaces") as JSONArray).objects(); valid(c, generation)
        val models = (c.json("/api/models") as JSONObject).objects("models"); valid(c, generation)
        update { it.copy(assistants = assistants, workspaces = workspaces, models = models) }
    }
    fun refresh() = action { c, generation -> refreshLists(c, generation); refreshSelection(c, generation) }
    private suspend fun refreshSelection(c: RelayClient, generation: Long) {
        val id = state.value.conversation?.optJSONObject("conversation")?.label("id") ?: return
        val detail = c.json("/api/conversations/$id") as JSONObject; valid(c, generation)
        if (state.value.conversation?.optJSONObject("conversation")?.label("id") != id) return
        update { it.copy(conversation = detail) }
        val taskId = state.value.task?.optJSONObject("task")?.label("id") ?: detail.objects("tasks").firstOrNull()?.label("id")
        if (!taskId.isNullOrBlank()) {
            val task = notifications.readTask(c, taskId, notificationBinding, watch = true); valid(c, generation)
            if (state.value.conversation?.optJSONObject("conversation")?.label("id") == id && (state.value.task == null || state.value.task?.optJSONObject("task")?.label("id") == taskId)) update { it.copy(task = task) }
        }
    }
    fun selectConversation(id: String) = action { c, generation ->
        val detail = c.json("/api/conversations/$id") as JSONObject; valid(c, generation)
        drafts[draftKey()] = record()
        val draft = loadDraft(id); valid(c, generation)
        update { restored(it.copy(conversation = detail, task = null, liveText = "", tab = "Chat", notice = null), draft) }
        pendingStart = null; refreshSelection(c, generation)
    }
    fun newConversation() = action { c, generation ->
        drafts[draftKey()] = record(); val draft = loadDraft("new"); valid(c, generation)
        pendingStart = null; update { restored(it.copy(conversation = null, task = null, liveText = "", tab = "Chat", notice = null), draft) }
    }
    fun draft(value: String) { update { it.copy(draft = value.take(32000)) }; persistDraft() }
    fun tab(value: String) { if (!state.value.busy) update { it.copy(tab = value, file = null, filePath = null) } }
    fun chooseAssistant(id: String?) { if (!state.value.busy) { update { it.copy(selectedAssistant = id) }; persistDraft() } }
    fun chooseModel(id: String?) { if (!state.value.busy) { update { it.copy(selectedModel = id) }; persistDraft() } }
    fun chooseWorkspace(id: String?) { if (!state.value.busy) { update { it.copy(selectedWorkspace = id) }; persistDraft() } }
    fun clearError() { update { it.copy(error = null) } }
    private fun options(): JSONObject {
        val s = state.value
        val permissions = s.session?.optJSONObject("user")?.optJSONObject("permissions") ?: JSONObject()
        return JSONObject().put("depth", "balanced").put("modelId", s.selectedModel ?: JSONObject.NULL)
            .put("modelSelection", if (s.selectedModel != null) "required" else "preferred")
            .put("access", "read_only").put("workspaceId", s.selectedWorkspace ?: JSONObject.NULL)
            .put("contextTokens", 8192).put("cloudPolicy", "local_only")
            .put("budget", JSONObject().put("maxCalls", minOf(8, permissions.optInt("maxCallsPerTask", 1)))
                .put("maxSeconds", minOf(300, permissions.optInt("maxSecondsPerTask", 30))).put("maxIterations", 8)
                .put("maxCostUsd", 0).put("localOnly", true))
            .also { s.selectedAssistant?.let { id -> it.put("assistantId", id) } }
    }
    fun send() {
        val s = state.value
        if (s.draft.isBlank() || s.uncertain) return
        val text = s.draft.trim()
        val conversationId = s.conversation?.optJSONObject("conversation")?.label("id")
        action { c, generation ->
            val submittedKey = conversationId ?: "new"
            val localDraftEpoch = draftEpoch
            update { it.copy(uncertain = true) }
            drafts[submittedKey] = record()
            val durable = record(); val revision = ++draftRevision
            withContext(Dispatchers.IO) { draftRepository.save(localDraftEpoch, submittedKey, revision, durable) }
            valid(c, generation)
            val body = JSONObject().put("content", text).put("options", options())
            if (conversationId == null) {
                val serialized = body.toString()
                val pending = pendingStart
                val requestId = if (pending != null && pending.second.toString() == serialized) pending.first else UUID.randomUUID().toString()
                pendingStart = requestId to JSONObject(serialized)
                body.put("requestId", requestId)
            }
            var admitted = false
            try {
                val result = c.json(if (conversationId == null) "/api/conversations/start" else "/api/conversations/$conversationId/messages", "POST", body) as JSONObject
                valid(c, generation)
                admitted = true
                val id = result.getJSONObject("task").getString("conversationId")
                notificationBinding?.let { notifications.watch(it, result) }
                val acknowledged = acknowledgedDraft(record(), text)
                drafts[submittedKey] = acknowledged
                update { restored(it, acknowledged) }
                val acknowledgedRevision = ++draftRevision
                withContext(Dispatchers.IO) { draftRepository.save(localDraftEpoch, submittedKey, acknowledgedRevision, acknowledged) }
                valid(c, generation)
                val detail = c.json("/api/conversations/$id") as JSONObject; valid(c, generation)
                pendingStart = null; drafts.remove(conversationId ?: "new")
                update { it.copy(conversation = detail, task = null, liveText = "", uncertain = false) }
                val destinationDraft = record(); val destinationRevision = ++draftRevision
                withContext(Dispatchers.IO) { draftRepository.save(localDraftEpoch, id, destinationRevision, destinationDraft) }
                valid(c, generation)
                if (conversationId == null) {
                    drafts["new"] = DraftRecord()
                    val cleanupRevision = ++draftRevision
                    withContext(Dispatchers.IO) { draftRepository.save(localDraftEpoch, "new", cleanupRevision, DraftRecord()) }
                    valid(c, generation)
                }
                persistDraft()
                refreshSelection(c, generation)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                valid(c, generation)
                if (admitted || e is RelayError) { update { it.copy(uncertain = false, notice = if (admitted) "The host accepted the task. Refresh History to inspect it." else it.notice) }; persistDraft() }
                else { update { it.copy(uncertain = true, error = "Delivery is uncertain. Refresh the conversation before deciding whether to send again.") }; persistDraft() }
                throw e
            }
        }
    }
    fun acknowledgeUncertain() { update { it.copy(uncertain = false, error = null) }; persistDraft() }
    fun inspectTask(id: String) = action { c, generation -> val task = notifications.readTask(c, id, notificationBinding, watch = true); valid(c, generation); liveCallId = null; update { it.copy(task = task, liveText = "") } }
    fun notificationPermissionSession() = epoch
    fun setTaskNotifications(enabled: Boolean, expectedSession: Long = epoch) {
        val binding = notificationBinding ?: return
        if (state.value.busy || expectedSession != epoch) return
        if (!enabled) notifications.clear()
        else if (!notifications.enable(binding)) {
            update { it.copy(notice = "Allow Relay notifications in Android settings, then enable task notifications here.") }; return
        }
        update { it.copy(taskNotifications = enabled, notice = null) }
        if (enabled) state.value.task?.let { notifications.watch(binding, it) }
    }
    fun openNotification(token: String) = action { c, generation ->
        val binding = notificationBinding ?: return@action
        val id = notifications.resolve(binding, token) ?: run {
            update { it.copy(notice = "This task notification has expired or belongs to a different session.") }; return@action
        }
        val task = notifications.readTask(c, id, binding); valid(c, generation)
        val conversationId = task.getJSONObject("task").getString("conversationId")
        require(NotificationLedger.safeId(conversationId))
        val conversation = c.json("/api/conversations/$conversationId") as JSONObject; valid(c, generation)
        if (notifications.resolve(binding, token) != id) return@action
        drafts[draftKey()] = record()
        val draft = loadDraft(conversationId); valid(c, generation)
        pendingStart = null; liveCallId = null
        notifications.dismiss(token)
        update { restored(it.copy(conversation = conversation, task = task, liveText = "", tab = "Chat", file = null, filePath = null, notice = null), draft) }
    }
    fun cancelTask(id: String) = action { c, generation -> c.json("/api/tasks/$id/cancel", "POST"); valid(c, generation); refreshSelection(c, generation) }
    fun approve(id: String, allow: Boolean) = action { c, generation ->
        c.json("/api/approvals/$id", "POST", JSONObject().put("decision", if (allow) "allow_once" else "denied")); valid(c, generation); refreshSelection(c, generation)
    }
    fun openWorkspace(id: String) = action { c, generation ->
        val data = c.json("/api/workspaces/$id/files") as JSONObject; valid(c, generation)
        val paths = data.getJSONArray("files")
        val files = (0 until paths.length()).map { JSONObject().put("path", paths.getString(it)) }
        update { it.copy(selectedWorkspace = id, files = files, file = null, filePath = null) }
        persistDraft()
    }
    fun openFile(path: String) = action { c, generation ->
        val id = state.value.selectedWorkspace ?: return@action
        val file = c.json("/api/workspaces/$id/file?path=${URLEncoder.encode(path, "UTF-8")}") as JSONObject; valid(c, generation)
        update { it.copy(file = file, filePath = path) }
    }
    fun closeFile() { if (!state.value.busy) update { it.copy(file = null, filePath = null) } }
    fun beginAttachmentPick(): Boolean {
        if (state.value.busy || state.value.session == null) return false
        pendingAttachmentTarget = AttachmentTarget(epoch, draftKey())
        return true
    }
    fun attachmentPicked(uri: Uri?) {
        val target = pendingAttachmentTarget
        pendingAttachmentTarget = null
        if (uri == null) return
        if (target == null) {
            if (state.value.session != null) update { it.copy(error = "The file selection expired. Choose the attachment again.") }
            return
        }
        prepareAttachment(uri, target)
    }
    fun prepareAttachment(uri: Uri, target: AttachmentTarget) {
        if (target.epoch != epoch || target.conversation != draftKey() || state.value.busy) return
        if (uri.scheme != "content") { update { it.copy(error = "Choose a file through the Android document picker.") }; return }
        action { c, generation ->
            val s = state.value
            val user = s.session!!.getJSONObject("user")
            val workspace = s.workspaces.firstOrNull { it.label("id") == s.selectedWorkspace }
            if (s.selectedWorkspace != null && workspace == null) throw RelayError(0, "Refresh Projects and select an available workspace before attaching a file.")
            if (workspace != null && workspace.label("ownerUserId") != user.label("id") && user.optJSONObject("permissions")?.label("maxAccess") == "read_only") throw RelayError(0, "This shared workspace is read-only. Select your own workspace or clear the task context to create a private one.")
            val prepared = withContext(Dispatchers.IO) {
                val resolver = getApplication<Application>().contentResolver
                val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                } ?: throw RelayError(0, "The selected document has no usable file name.")
                resolver.openInputStream(uri)?.use {
                    try { Attachments.prepare(name, it) } catch (error: IllegalArgumentException) { throw RelayError(0, error.message ?: "This attachment is unsupported.") }
                } ?: throw RelayError(0, "The selected document could not be opened.")
            }
            valid(c, generation)
            if (target.conversation != draftKey()) return@action
            preparedAttachment = prepared
            update { it.copy(attachment = AttachmentReview(prepared.name, prepared.bytes.size, prepared.document, s.selectedWorkspace, workspace?.label("name") ?: "New private attachment workspace"), error = null) }
        }
    }
    fun discardAttachment() { if (!state.value.busy) { preparedAttachment = null; update { it.copy(attachment = null) } } }
    fun uploadAttachment() {
        val prepared = preparedAttachment ?: return
        val review = state.value.attachment ?: return
        action { c, generation ->
            var uploadAcknowledged = false
            try {
            var workspaceId = review.workspaceId
            if (workspaceId == null) {
                val created = c.json("/api/workspaces", "POST", JSONObject().put("name", "Conversation attachments").put("personal", true)) as JSONObject
                valid(c, generation); workspaceId = created.getString("id")
                update { it.copy(selectedWorkspace = workspaceId, workspaces = (it.workspaces + created).distinctBy { value -> value.label("id") }, attachment = review.copy(workspaceId = workspaceId, workspaceName = created.label("name"))) }
                persistDraft()
            }
            val path = if (prepared.document) {
                val result = c.json("/api/workspaces/$workspaceId/documents", "POST", JSONObject().put("name", prepared.name).put("contentBase64", Base64.encodeToString(prepared.bytes, Base64.NO_WRAP))) as JSONObject
                valid(c, generation)
                if (!result.optBoolean("uploaded")) throw RelayError(0, "The host did not confirm the document import.")
                result.getString("path")
            } else {
                val path = "attachments/${UUID.randomUUID()}/${prepared.name}"
                val result = c.json("/api/workspaces/$workspaceId/files", "POST", JSONObject().put("path", path).put("content", prepared.text)) as JSONObject
                valid(c, generation)
                if (!result.optBoolean("uploaded")) throw RelayError(0, "The host did not confirm the file upload.")
                path
            }
            uploadAcknowledged = true
            preparedAttachment = null
            update { it.copy(attachment = null, selectedWorkspace = workspaceId, notice = if (prepared.document) "Document imported as text. The original document is not stored on Relay." else "File uploaded to the selected workspace.") }
            try { update { it.copy(draft = Attachments.appendReceipt(it.draft, path)) } }
            catch (error: IllegalArgumentException) { throw RelayError(0, error.message ?: "Open Projects to inspect the uploaded file.") }
            persistDraft()
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                valid(c, generation)
                // A response failure can follow a committed write. Never retain
                // a retryable mutation after an unconfirmed result.
                if (!uploadAcknowledged && (error !is RelayError || error.status !in 400..499)) {
                    preparedAttachment = null
                    update { it.copy(attachment = null, notice = "The upload result is uncertain. Inspect Projects before choosing this file again; the host may already have saved a copy.") }
                }
                throw error
            }
        }
    }
    fun foreground(active: Boolean) {
        foreground = active
        if (active) {
            notificationBinding?.let { binding -> update { it.copy(taskNotifications = notifications.enabled(binding)) } }
            startRealtime()
        } else stopRealtime()
    }
    private fun stopRealtime() { streamJob?.cancel(); streamJob = null; refreshJob?.cancel(); refreshJob = null }
    private fun startRealtime() {
        val c = client ?: return
        if (!foreground || state.value.session == null || streamJob?.isActive == true) return
        val generation = epoch
        streamJob = viewModelScope.launch {
            var failures = 0
            while (isActive && client === c) {
                update { it.copy(stream = if (failures == 0) "Connecting" else "Reconnecting") }
                try {
                    c.events(cursor, scope).collect { frame ->
                        valid(c, generation)
                        val data = JSONObject(frame.data)
                        if (frame.type == "replay") {
                            val nextScope = data.getString("scope")
                            require(Regex("^[a-f0-9]{64}$").matches(nextScope))
                            if (scope != nextScope) update { it.copy(events = emptyList(), liveText = "") }
                            scope = nextScope; cursor = data.getLong("after"); require(cursor in 0..9007199254740991L)
                        } else if (frame.type == "activity") {
                            val id = data.getLong("id")
                            require(id in 1..9007199254740991L)
                            if (id > cursor) {
                                update { old ->
                                    val selected = old.task?.optJSONObject("task")?.label("id")
                                    val payload = data.optJSONObject("data")
                                    val text = if (data.label("taskId") == selected && data.label("type") == "MODEL_TEXT" && payload?.label("role") in listOf("worker", "supervisor")) {
                                        val callId = payload?.label("callId", payload.label("stepId", selected ?: ""))
                                        val previous = if (callId == liveCallId) old.liveText else ""
                                        liveCallId = callId
                                        (previous + payload?.label("text")).takeLast(64000)
                                    } else old.liveText
                                    old.copy(events = (old.events + data).takeLast(100), liveText = text)
                                }
                                cursor = id
                                val snapshot = if (data.label("type") in setOf("TASK_COMPLETED", "TASK_FAILED", "TOOL_APPROVAL_REQUIRED", "APPROVAL_DECIDED", "TASK_CANCELLED", "TASK_PAUSED")) notifications.snapshot() else null
                                if (snapshot != null && snapshot.binding == notificationBinding && data.label("taskId") in snapshot.ids &&
                                    data.label("type") in setOf("TASK_COMPLETED", "TASK_FAILED", "TOOL_APPROVAL_REQUIRED", "APPROVAL_DECIDED", "TASK_CANCELLED", "TASK_PAUSED")) {
                                    try {
                                        notifications.readTask(c, data.label("taskId"), snapshot.binding, expected = snapshot); valid(c, generation)
                                    } catch (error: RelayError) {
                                        if (error.status == 401) throw error
                                        if (error.status in listOf(403, 404)) notifications.forget(snapshot, data.label("taskId"))
                                    }
                                }
                            }
                        }
                        failures = 0; update { it.copy(stream = "Live") }
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { if (e is RelayError && e.status == 401) { handleFailure(e, c, generation); break } }
                failures++; update { it.copy(stream = "Reconnecting") }; delay(minOf(20000L, 1500L * failures))
            }
        }
        refreshJob = viewModelScope.launch {
            while (isActive) {
                delay(3000)
                if (!state.value.busy) try { refreshSelection(c, generation) } catch (e: CancellationException) { throw e } catch (e: Exception) { handleFailure(e, c, generation) }
            }
        }
    }
    fun disconnect(sendLogout: Boolean = true) {
        val old = client
        notifications.clear(); notificationBinding = null
        epoch++; client = null; actionJob?.cancel(); stopRealtime(); cursor = 0; scope = null; pendingStart = null; drafts.clear(); preparedAttachment = null; pendingAttachmentTarget = null
        val cleared = runCatching { draftRepository.clear() }.isSuccess
        sessionRecovery.forget(); update { RelayUi(error = if (cleared) null else "Signed out. Android could not confirm deletion of protected drafts; clear the app's storage in Android settings if needed.") }
        if (old != null) viewModelScope.launch {
            try { if (sendLogout) old.json("/api/session/logout", "POST") }
            catch (_: Exception) { if (client == null) update { it.copy(error = "Signed out on this device. The host could not confirm session termination; ask the owner to revoke it if needed.") } }
            finally { old.close() }
        }
    }
    override fun onCleared() { stopRealtime(); client?.close(); super.onCleared() }
}
