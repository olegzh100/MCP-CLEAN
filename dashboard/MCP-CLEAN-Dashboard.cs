using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

class Program
{
    const string BaseUrl = "http://127.0.0.1:3210";

    static bool IsUp()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/status");
            req.Timeout = 1500;
            req.ReadWriteTimeout = 1500;
            using (var resp = (HttpWebResponse)req.GetResponse())
                return (int)resp.StatusCode >= 200 && (int)resp.StatusCode < 500;
        }
        catch { return false; }
    }

    static string FindNode()
    {
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var candidate = Path.Combine(pf, "nodejs", "node.exe");
        if (File.Exists(candidate)) return candidate;
        return "node.exe";
    }

    static string FindEdge()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe")
        };
        foreach (var c in candidates) if (File.Exists(c)) return c;
        return "msedge.exe";
    }

    [STAThread]
    static void Main()
    {
        var dashboardDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var server = Path.Combine(dashboardDir, "server.mjs");

        if (!IsUp())
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = FindNode(),
                    Arguments = "\"" + server + "\"",
                    WorkingDirectory = dashboardDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch { }

            for (int i = 0; i < 20 && !IsUp(); i++) Thread.Sleep(500);
        }

        try
        {
            var edge = new ProcessStartInfo
            {
                FileName = FindEdge(),
                Arguments = "--app=\"" + BaseUrl + "\"",
                UseShellExecute = true
            };
            Process.Start(edge);
        }
        catch
        {
            Process.Start(new ProcessStartInfo(BaseUrl) { UseShellExecute = true });
        }
    }
}
