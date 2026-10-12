package app.relay.nativeclient

import android.os.Bundle
import android.os.Build
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent {
            val dark = isSystemInDarkTheme()
            MaterialTheme(colorScheme = if (dark) darkColorScheme(primary = Color(0xFFD7ACEC), secondary = Color(0xFFBDB1C9), background = Color(0xFF17141C), surface = Color(0xFF211C28)) else lightColorScheme(primary = Color(0xFF693A80), secondary = Color(0xFF645B70), background = Color(0xFFF5F3F7), surface = Color(0xFFFFFFFF))) {
                LocalNetworkPermission { val vm: RelayViewModel = viewModel(); RelayApp(vm) }
            }
        }
    }
}

@Composable private fun LocalNetworkPermission(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val permission = "android.permission.ACCESS_LOCAL_NETWORK"
    fun allowed() = Build.VERSION.SDK_INT < 37 || context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    var granted by remember { mutableStateOf(allowed()) }
    var denied by remember { mutableStateOf(false) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; denied = !it }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) granted = allowed() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    if (granted) content()
    else Surface(Modifier.fillMaxSize()) {
        Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text("Connect to your Relay host", style = MaterialTheme.typography.headlineLarge)
            Text("Android needs your permission before Relay can reach the host on your local network. The app connects only to the HTTPS address you choose.")
            if (denied) Text("Local network permission was not granted. You can allow it here or in Android app settings.")
            Button(onClick = { request.launch(permission) }) { Text("Allow local network access") }
            if (denied) TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("Open app settings") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun RelayApp(vm: RelayViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) vm.foreground(true)
            if (event == Lifecycle.Event.ON_STOP) vm.foreground(false)
        }
        lifecycle.addObserver(observer)
        vm.foreground(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
        onDispose { lifecycle.removeObserver(observer); vm.foreground(false) }
    }
    BackHandler(state.session != null && (state.file != null || state.tab != "Chat")) { if (state.file != null) vm.closeFile() else vm.tab("Chat") }
    Scaffold(
        topBar = { TopAppBar(title = { Column { Text("Relay", style = MaterialTheme.typography.titleLarge); Text(if (state.session == null) "Native · LAN preview" else "${state.session!!.label("hostName", "Your host")} · ${state.stream}", style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis) } }, actions = { if (state.session != null) TextButton(onClick = vm::refresh, enabled = !state.busy) { Text("Refresh") } }) },
        bottomBar = {
            if (state.session != null) NavigationBar {
                listOf("Chat", "Agents", "Projects", "Account").forEach { name ->
                    NavigationBarItem(selected = state.tab == name, onClick = { vm.tab(name) },
                        icon = { Text(name.take(1), style = MaterialTheme.typography.titleMedium) }, label = { Text(name) })
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.error?.let { error ->
                Surface(color = MaterialTheme.colorScheme.errorContainer) {
                    Row(Modifier.fillMaxWidth().padding(12.dp)) {
                        Text(error, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = vm::clearError) { Text("Dismiss") }
                    }
                }
            }
            state.notice?.let { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall) }
            if (state.session == null) ConnectScreen(state, vm)
            else when (state.tab) {
                "Chat" -> {
                    val expanded = currentWindowAdaptiveInfoV2().windowSizeClass.isWidthAtLeastBreakpoint(840)
                    Row(Modifier.fillMaxSize()) {
                        if (expanded) LazyColumn(Modifier.width(280.dp).fillMaxHeight().padding(12.dp)) {
                            item { Text("Conversations", style = MaterialTheme.typography.titleLarge) }
                            items(state.conversations, key = { it.label("id") }) { conversation ->
                                TextButton(onClick = { vm.selectConversation(conversation.getString("id")) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                                    Text(conversation.label("title", "Conversation"), maxLines = 3, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        Box(Modifier.weight(1f)) { ChatScreen(state, vm) }
                    }
                }
                "Agents" -> AgentsScreen(state, vm)
                "Projects" -> ProjectsScreen(state, vm)
                else -> AccountScreen(state, vm)
            }
        }
    }
}

@Composable private fun ConnectScreen(state: RelayUi, vm: RelayViewModel) {
    var origin by remember { mutableStateOf(state.origin) }
    var invitation by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("Your work, within reach.", style = MaterialTheme.typography.headlineLarge)
        Text("Connect to the Relay host on your local network. Your tasks run on the host while you review them here.", style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(value = origin, onValueChange = { origin = it }, label = { Text("LAN HTTPS address") }, placeholder = { Text("https://relay.example.com:4319") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), enabled = !state.busy)
        OutlinedTextField(value = invitation, onValueChange = { invitation = it }, label = { Text("One-use invitation") }, supportingText = { Text("Ask the host owner for an invitation. It expires after five minutes.") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), enabled = !state.busy)
        Button(onClick = { val token = invitation; invitation = ""; vm.connect(origin, token) }, enabled = !state.busy && origin.isNotBlank() && invitation.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Connect securely") }
        HorizontalDivider()
        Text("Before connecting", style = MaterialTheme.typography.titleMedium)
        Text("The owner must enable Relay's separate LAN HTTPS listener. Your phone must trust its certificate and reach it on the private network.")
        Text("Cloudflare Access remote sign-in is not yet supported in this preview. Use Relay in your browser for existing public access.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ChatScreen(s: RelayUi, vm: RelayViewModel) {
    var history by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(), vm::attachmentPicked)
    s.attachment?.let { attachment ->
        AlertDialog(onDismissRequest = vm::discardAttachment,
            title = { Text("Review attachment") },
            text = { Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(attachment.name, style = MaterialTheme.typography.titleMedium)
                Text("${java.text.NumberFormat.getIntegerInstance().format(attachment.bytes)} bytes")
                Text("Destination: ${attachment.workspaceName}")
                Text("Host: ${s.origin}")
                Text("Workspace ID: ${attachment.workspaceId ?: "A new private workspace will be created"}")
                Text(if (attachment.document) "Relay will extract a text copy on the host. The original document is not stored there." else "A text copy will be saved in this workspace on the host.")
                Text("Uploading does not send a task or grant file tools. People with access to this workspace can read the copy.")
            } },
            confirmButton = { TextButton(onClick = vm::uploadAttachment, enabled = !s.busy) { Text("Upload copy") } },
            dismissButton = { TextButton(onClick = vm::discardAttachment, enabled = !s.busy) { Text("Cancel") } })
    }

    if (history) ModalBottomSheet(onDismissRequest = { history = false }) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 600.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text("Conversations", style = MaterialTheme.typography.headlineSmall) }
            if (s.conversations.isEmpty()) item { Text("No conversations yet. Start one below.") }
            items(s.conversations, key = { it.label("id") }) { c -> OutlinedCard(onClick = { vm.selectConversation(c.getString("id")); history = false }, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(c.label("title", "Conversation")); Text(c.label("updatedAt"), style = MaterialTheme.typography.labelSmall) } } }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { history = true }, enabled = !s.busy) { Text("History") }
            TextButton(onClick = vm::newConversation, enabled = !s.busy) { Text("New conversation") }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(bottom = 16.dp)) {
            item { Text(s.conversation?.optJSONObject("conversation")?.label("title") ?: "What needs doing?", style = MaterialTheme.typography.headlineMedium) }
            if (s.conversation == null) item { Text("Start a task with local AI. This preview requests read-only access, no cloud spending, and the permissions your account already has.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(s.conversation?.objects("messages") ?: emptyList(), key = { it.label("id") }) { message -> Surface(shape = MaterialTheme.shapes.medium, color = if (message.label("role") == "user") MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer) { Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { Text(if (message.label("role") == "user") "You" else "Relay", style = MaterialTheme.typography.labelMedium); SelectionContainer { Text(message.label("content")) } } } }
            items(s.conversation?.objects("tasks") ?: emptyList(), key = { it.label("id") }) { task -> OutlinedCard(onClick = { vm.inspectTask(task.getString("id")) }, modifier = Modifier.fillMaxWidth()) { Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) { Text("Task · ${task.label("status").replace('_', ' ')}", Modifier.weight(1f)); Text("Inspect", color = MaterialTheme.colorScheme.primary) } } }
            s.task?.let { detail -> item { TaskPanel(detail, s, vm) } }
            if (s.liveText.isNotBlank() && s.task?.optJSONObject("task")?.label("status") !in listOf("completed", "failed", "cancelled")) item { Column { Text("Live output · not yet a verified result", style = MaterialTheme.typography.labelSmall); SelectionContainer { Text(s.liveText) } } }
        }
        Surface(tonalElevation = 3.dp) { Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoiceMenu("Profile", s.assistants.firstOrNull { it.label("id") == s.selectedAssistant }?.label("name") ?: "General", s.assistants.filter { it.optBoolean("available") }.map { it.label("id") to it.label("name") }, vm::chooseAssistant, !s.busy, Modifier.weight(1f))
                ChoiceMenu("Model", s.models.firstOrNull { it.label("id") == s.selectedModel }?.label("name") ?: "Auto", s.models.filter { it.optBoolean("local") }.map { it.label("id") to it.label("name") }, vm::chooseModel, !s.busy, Modifier.weight(1f))
            }
            if (s.uncertain) { Text("The last message may already have arrived. Refresh and inspect the conversation before sending it again.", color = MaterialTheme.colorScheme.error); TextButton(onClick = vm::acknowledgeUncertain) { Text("I reviewed it · allow another send") } }
            OutlinedTextField(value = s.draft, onValueChange = vm::draft, placeholder = { Text("Describe the task…") }, modifier = Modifier.fillMaxWidth().heightIn(max = 160.dp), minLines = 2, maxLines = 5)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = {
                    if (vm.beginAttachmentPick()) picker.launch(arrayOf("*/*"))
                }, enabled = !s.busy && s.attachment == null) { Text("Attach file") }
                Button(onClick = vm::send, enabled = !s.busy && s.draft.isNotBlank() && !s.uncertain) { Text("Send task") }
            }
            Text("Local AI · read-only · ${s.draftStatus}", style = MaterialTheme.typography.labelSmall)
        } }
    }
}

@Composable private fun ChoiceMenu(label: String, selected: String, choices: List<Pair<String, String>>, choose: (String?) -> Unit, enabled: Boolean, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) { OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("$label: $selected", maxLines = 1, overflow = TextOverflow.Ellipsis) }; DropdownMenu(expanded = open, onDismissRequest = { open = false }) { DropdownMenuItem(text = { Text("Automatic / general") }, onClick = { choose(null); open = false }); choices.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { choose(id); open = false }) } } }
}

@Composable private fun TaskPanel(detail: JSONObject, s: RelayUi, vm: RelayViewModel) {
    val task = detail.optJSONObject("task") ?: return
    var cancel by remember(task.label("id")) { mutableStateOf(false) }
    var review by remember(task.label("id")) { mutableStateOf<JSONObject?>(null) }
    if (cancel) AlertDialog(onDismissRequest = { cancel = false }, title = { Text("Cancel this task?") }, text = { Text("Relay will stop this task. Changes already made may remain and can be inspected on the host.") }, confirmButton = { TextButton(onClick = { cancel = false; vm.cancelTask(task.getString("id")) }) { Text("Cancel task") } }, dismissButton = { TextButton(onClick = { cancel = false }) { Text("Keep running") } })
    review?.let { approval -> AlertDialog(onDismissRequest = { review = null }, title = { Text("Review ${approval.label("tool")}") }, text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) { Text("Host: ${s.origin}", style = MaterialTheme.typography.labelMedium)
                Text("Task: ${task.label("id")}")
                Text(task.label("objective", "Task objective not recorded"))
                val workspaceId = task.optJSONObject("options")?.label("workspaceId").orEmpty()
                val workspaceName = s.workspaces.firstOrNull { it.label("id") == workspaceId }?.label("name")
                Text(if (workspaceId.isBlank()) "Workspace: no workspace assigned" else "Workspace: ${workspaceName ?: "Name unavailable"} ($workspaceId)")
                Text("Proposing model: ${approvalModel(approval, detail.objects("events"))}")
                Text(approval.label("reason"))
                if (approval.label("tool") == "cloud_egress") Text("Allow once permits this request to send selected conversation and workspace context outside your host to the named cloud provider. Sensitive content may be included, provider retention applies, and usage may incur cost within the host's authorized budget.", color = MaterialTheme.colorScheme.error)
                Text("Allow applies to this exact request once. It does not change account permissions."); SelectionContainer { Text(approval.optJSONObject("arguments")?.toString(2) ?: "{}", fontFamily = FontFamily.Monospace) } } }, confirmButton = { TextButton(onClick = { review = null; vm.approve(approval.getString("id"), true) }, enabled = !s.busy) { Text("Allow once") } }, dismissButton = { TextButton(onClick = { review = null; vm.approve(approval.getString("id"), false) }, enabled = !s.busy) { Text("Deny") } }) }
    OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Execution", style = MaterialTheme.typography.titleLarge)
        Text(task.label("status").replace('_', ' '), color = MaterialTheme.colorScheme.primary)
        detail.objects("steps").forEach { step -> Column { Text("${step.label("role")} · ${step.label("status")}", style = MaterialTheme.typography.labelMedium); Text(step.label("title")); Text(step.label("modelId", "Model not assigned"), style = MaterialTheme.typography.bodySmall) } }
        detail.objects("approvals").filter { it.label("status") == "pending" }.forEach { approval -> Button(onClick = { review = approval }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) { Text("Review ${approval.label("tool")}") } }
        detail.objects("verification").takeLast(8).forEach { proof -> Text("${if (proof.optBoolean("passed")) "Verified" else "Not verified"}: ${proof.label("summary")}", style = MaterialTheme.typography.bodySmall) }
        val events = (detail.objects("events") + s.events.filter { it.label("taskId") == task.label("id") }).distinctBy { it.optLong("id") }.takeLast(8)
        if (events.isNotEmpty()) { HorizontalDivider(); Text("Recent activity", style = MaterialTheme.typography.titleSmall); events.forEach { event -> Text(event.label("type").lowercase().replace('_', ' '), style = MaterialTheme.typography.bodySmall) } }
        if (task.label("status") !in listOf("completed", "failed", "cancelled")) OutlinedButton(onClick = { cancel = true }, enabled = !s.busy) { Text("Cancel task") }
    } }
}

@Composable private fun AgentsScreen(s: RelayUi, vm: RelayViewModel) {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Agents", style = MaterialTheme.typography.headlineLarge); Text("Choose a specialist for your next task. Profiles do not grant tools or start running agents.") }
        if (s.assistants.isEmpty()) item { Text("No specialist catalog is available. Refresh to query the host.") }
        items(s.assistants, key = { it.label("id") }) { assistant -> OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(assistant.label("name"), style = MaterialTheme.typography.titleLarge); Text(assistant.label("description")); Text(assistant.label("status").replace('_', ' '), color = MaterialTheme.colorScheme.primary)
            assistant.optJSONArray("limitations")?.let { limits -> for (i in 0 until limits.length()) Text(limits.getString(i), style = MaterialTheme.typography.bodySmall) }
            val tools = assistant.optJSONArray("tools")
            Text("Available tools: " + if (tools == null || tools.length() == 0) "none" else (0 until tools.length()).joinToString { tools.getString(it) }, style = MaterialTheme.typography.bodySmall)
            if (assistant.optBoolean("available")) Button(onClick = { vm.chooseAssistant(assistant.getString("id")); vm.tab("Chat") }, enabled = !s.busy) { Text("Use for next task") }
        } } }
    }
}

@Composable private fun ProjectsScreen(s: RelayUi, vm: RelayViewModel) {
    if (s.file != null) Column(Modifier.fillMaxSize().padding(16.dp)) { TextButton(onClick = vm::closeFile) { Text("Back to files") }; Text(s.filePath ?: "File", style = MaterialTheme.typography.titleLarge); SelectionContainer { Text(s.file.label("content", "This file has no text content."), modifier = Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace) } }
    else LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("Projects", style = MaterialTheme.typography.headlineLarge); Text("Browse workspaces shared with your account. Selecting one also sets the context for your next task.") }
        if (s.workspaces.isEmpty()) item { Text("No workspaces are available for this account.") }
        items(s.workspaces, key = { it.label("id") }) { workspace -> OutlinedCard(onClick = { vm.openWorkspace(workspace.getString("id")) }, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(workspace.label("name"), style = MaterialTheme.typography.titleMedium); Text(if (s.selectedWorkspace == workspace.label("id")) "Selected · ${workspace.optInt("fileCount")} files" else "${workspace.optInt("fileCount")} files") } } }
        if (s.selectedWorkspace != null) {
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Files", style = MaterialTheme.typography.titleLarge); TextButton(onClick = { vm.chooseWorkspace(null) }, enabled = !s.busy) { Text("Clear task context") } } }
            if (s.files.isEmpty()) item { Text("No browsable files have been loaded for this workspace.") }
            items(s.files, key = { it.label("path") }) { file -> TextButton(onClick = { vm.openFile(file.getString("path")) }, modifier = Modifier.fillMaxWidth(), enabled = !s.busy) { Text(file.label("path"), Modifier.fillMaxWidth()) } }
        }
    }
}

@Composable private fun AccountScreen(s: RelayUi, vm: RelayViewModel) {
    var confirm by remember { mutableStateOf(false) }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Sign out of Relay?") }, text = { Text("This clears the session on this phone. Tasks already running on the host are not cancelled.") }, confirmButton = { TextButton(onClick = { confirm = false; vm.disconnect() }) { Text("Sign out") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Stay connected") } })
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("Account", style = MaterialTheme.typography.headlineLarge)
        Text(s.session?.optJSONObject("user")?.label("name", "Connected account") ?: "", style = MaterialTheme.typography.titleLarge)
        Text(s.origin); Text("LAN HTTPS · ${s.stream}")
        Text("The host enforces your account permissions. Your phone cannot grant computer access, spend on cloud models or use local-owner controls.")
        Text("Drafts are encrypted on this device and deleted on sign-out. This preview follows activity while open. It does not provide background push notifications or Cloudflare Access sign-in.")
        OutlinedButton(onClick = { confirm = true }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        Text("Native preview 0.2.0 · debug testing build", style = MaterialTheme.typography.labelSmall)
    }
}
