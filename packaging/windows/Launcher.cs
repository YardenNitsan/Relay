using System;
using System.Diagnostics;
using System.IO;

// Native activation entry point. The host retains its ordinary user identity;
// neither installation nor startup requests elevation or changes execution policy.
internal static class RelayLauncher {
    private static int Main(string[] args) {
        if (args.Length > 1 || (args.Length == 1 && args[0] != "--pair")) {
            Console.Error.WriteLine("Usage: Relay.exe [--pair]");
            return 2;
        }
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(directory, "runtime", "node.exe");
        string launch = Path.Combine(directory, "launch.mjs");
        if (!File.Exists(node) || !File.Exists(launch)) {
            Console.Error.WriteLine("Relay installation is incomplete. Reinstall the signed package.");
            return 1;
        }
        var info = new ProcessStartInfo(node);
        info.Arguments = "\"" + launch + "\"" + (args.Length == 1 ? " --pair" : "");
        info.WorkingDirectory = directory;
        info.UseShellExecute = false;
        if (args.Length == 0) Console.WriteLine("Relay host: http://127.0.0.1:4317. Close with Ctrl+C. Pair a browser using Relay.exe --pair.");
        using (Process child = Process.Start(info)) {
            if (child == null) return 1;
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
