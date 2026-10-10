param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string[]]$CommandArguments = @()
)

# Hosted Windows runners can create files owned by BUILTIN\Administrators.
# Relay correctly requires the individual account as private-storage owner.
# Configure this test process's default object owner; never take ownership of
# existing files or change the machine's security policy. Restore it on exit.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class RelayTestToken {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int required);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool SetTokenInformation(IntPtr token, int kind, IntPtr data, int size);
  public static string SetOwner(string value) {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0080 | 0x0008, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
    IntPtr previous = IntPtr.Zero, sid = IntPtr.Zero, owner = IntPtr.Zero;
    try {
      int required;
      GetTokenInformation(token, 4, IntPtr.Zero, 0, out required);
      if (required <= 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      previous = Marshal.AllocHGlobal(required);
      if (!GetTokenInformation(token, 4, previous, required, out required)) throw new Win32Exception(Marshal.GetLastWin32Error());
      string old = new SecurityIdentifier(Marshal.ReadIntPtr(previous)).Value;
      var identity = new SecurityIdentifier(value);
      var bytes = new byte[identity.BinaryLength]; identity.GetBinaryForm(bytes, 0);
      sid = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, sid, bytes.Length);
      owner = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(owner, sid);
      if (!SetTokenInformation(token, 4, owner, IntPtr.Size)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return old;
    } finally {
      if (owner != IntPtr.Zero) Marshal.FreeHGlobal(owner);
      if (sid != IntPtr.Zero) Marshal.FreeHGlobal(sid);
      if (previous != IntPtr.Zero) Marshal.FreeHGlobal(previous);
      CloseHandle(token);
    }
  }
}
'@

$relaySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$relayPreviousOwner = [RelayTestToken]::SetOwner($relaySid)
try {
  & $Command @CommandArguments
  $relayExitCode = $LASTEXITCODE
} finally {
  [void][RelayTestToken]::SetOwner($relayPreviousOwner)
}
exit $relayExitCode
