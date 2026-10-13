package app.relay.nativeclient

/** Keeps only the retry origin in memory; credentials are read from the protected vault. */
internal class SessionRecovery(private val load: () -> Pair<String, String>?, private val clear: () -> Unit) {
    var origin: String? = null
        private set

    fun failed(requestOrigin: String, error: Exception): Boolean {
        origin = null
        if (error is RelayError && error.status == 401) { forget(); return false }
        // An invitation alone is never retry authority. A successful redemption
        // may already have persisted its cookie before a subsequent read failed.
        if (load()?.first == requestOrigin) origin = requestOrigin
        return origin != null
    }

    fun retry(): Pair<String, String>? {
        val expected = origin ?: return null
        return load()?.takeIf { it.first == expected }.also { if (it == null) origin = null }
    }

    fun verified() { origin = null }
    fun forget() { origin = null; clear() }
}
