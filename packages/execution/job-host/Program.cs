using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

sealed record JobConfig(string File, string[] Args, string Cwd, string StatusPath, string CancelPath, int TimeoutMs, int OwnerPid, string OwnerStartTicks);
sealed record JobStatus(string Reason, int? ExitCode, int ChildPid, DateTimeOffset CompletedAt);

static class Native
{
    internal const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    internal const int JobObjectExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential)] internal struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct BASIC_LIMIT
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct EXTENDED_LIMIT
    {
        public BASIC_LIMIT BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool TerminateJobObject(IntPtr hJob, uint exitCode);
    internal const uint CREATE_SUSPENDED = 0x00000004;
    internal const uint CREATE_NO_WINDOW = 0x08000000;
    internal const uint STARTF_USESTDHANDLES = 0x00000100;
    internal const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct STARTUPINFO
    {
        public int cb;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES attrs, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateProcess(string? application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION result);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint timeoutMs);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(IntPtr handle, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool CloseHandle(IntPtr hObject);
}

static class Program
{
    private static string Quote(string value)
    {
        if (value.Length > 0 && value.All(c => c != '"' && c != ' ' && c != '\t' && c != '\n')) return value;
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(ch);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return 70;
        if (args.Length != 1) return 64;
        JobConfig config;
        try { config = JsonSerializer.Deserialize<JobConfig>(File.ReadAllText(args[0])) ?? throw new InvalidDataException(); }
        catch { return 65; }
        if (string.IsNullOrWhiteSpace(config.File) || config.Args is null || string.IsNullOrWhiteSpace(config.Cwd) ||
            config.TimeoutMs < 1 || config.TimeoutMs > 3_600_000 || config.OwnerPid <= 0 || string.IsNullOrWhiteSpace(config.OwnerStartTicks)) return 66;

        IntPtr job = Native.CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return 71;
        IntPtr input = IntPtr.Zero, output = IntPtr.Zero, errorOutput = IntPtr.Zero;
        Native.PROCESS_INFORMATION childInfo = default;
        bool resumed = false;
        try
        {
            var limits = new Native.EXTENDED_LIMIT();
            limits.BasicLimitInformation.LimitFlags = Native.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int size = Marshal.SizeOf<Native.EXTENDED_LIMIT>();
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, ptr, false);
                if (!Native.SetInformationJobObject(job, Native.JobObjectExtendedLimitInformation, ptr, (uint)size)) return 72;
            }
            finally { Marshal.FreeHGlobal(ptr); }

            // Windows creates the primary thread SUSPENDED; no command or grandchild
            // can run before successful Job Object assignment and ResumeThread.
            var inheritable = new Native.SECURITY_ATTRIBUTES
                { nLength = Marshal.SizeOf<Native.SECURITY_ATTRIBUTES>(), bInheritHandle = true };
            input = Native.CreateFile("NUL", 0x80000000, 3, ref inheritable, 3, 0, IntPtr.Zero);
            if (input == IntPtr.Zero || input == new IntPtr(-1)) return 75;
            IntPtr self = Native.GetCurrentProcess();
            if (!Native.DuplicateHandle(self, Native.GetStdHandle(-11), self, out output, 0, true, Native.DUPLICATE_SAME_ACCESS) ||
                !Native.DuplicateHandle(self, Native.GetStdHandle(-12), self, out errorOutput, 0, true, Native.DUPLICATE_SAME_ACCESS)) return 75;
            var startup = new Native.STARTUPINFO
            {
                cb = Marshal.SizeOf<Native.STARTUPINFO>(), dwFlags = Native.STARTF_USESTDHANDLES,
                hStdInput = input, hStdOutput = output, hStdError = errorOutput,
            };
            var command = new StringBuilder(string.Join(" ", new[] { Quote(config.File) }.Concat(config.Args.Select(Quote))));
            if (!Native.CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, true,
                Native.CREATE_SUSPENDED | Native.CREATE_NO_WINDOW, IntPtr.Zero, config.Cwd, ref startup, out childInfo)) return 73;
            if (!Native.AssignProcessToJobObject(job, childInfo.hProcess)) return 74;
            if (Native.ResumeThread(childInfo.hThread) == uint.MaxValue) return 76;
            resumed = true;
            Native.CloseHandle(input); input = IntPtr.Zero;
            Native.CloseHandle(output); output = IntPtr.Zero;
            Native.CloseHandle(errorOutput); errorOutput = IntPtr.Zero;
            // Hold the original kernel process handle: GetProcessById can race
            // with a very short-lived child and falsely lose its exit code.
            string reason = "exited";
            using var timer = new CancellationTokenSource(config.TimeoutMs);
            while (Native.WaitForSingleObject(childInfo.hProcess, 0) == 258)
            {
                bool ownerAlive;
                try
                {
                    using var owner = Process.GetProcessById(config.OwnerPid);
                    ownerAlive = owner.StartTime.ToUniversalTime().Ticks.ToString() == config.OwnerStartTicks;
                }
                catch { ownerAlive = false; }
                if (!ownerAlive) reason = "worker_lost";
                else if (File.Exists(config.CancelPath)) reason = "canceled";
                else if (timer.IsCancellationRequested) reason = "timed_out";
                if (reason != "exited")
                {
                    if (!Native.TerminateJobObject(job, 0xC000013A)) return 78;
                    break;
                }
                await Task.Delay(50);
            }
            if (Native.WaitForSingleObject(childInfo.hProcess, 10_000) != 0) return 80;
            if (!Native.GetExitCodeProcess(childInfo.hProcess, out uint rawExitCode)) return 81;
            int? exitCode = reason == "exited" ? unchecked((int)rawExitCode) : null;
            // A status is evidence only after the Job handle has been closed:
            // descendants are terminated even when their parent exited normally.
            if (!Native.CloseHandle(job)) return 79;
            job = IntPtr.Zero;
            Directory.CreateDirectory(Path.GetDirectoryName(config.StatusPath)!);
            string temp = config.StatusPath + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(temp, JsonSerializer.Serialize(new JobStatus(reason, exitCode, checked((int)childInfo.dwProcessId), DateTimeOffset.UtcNow)));
            File.Move(temp, config.StatusPath, false);
            return reason == "exited" ? exitCode!.Value : reason == "canceled" ? 201 : reason == "timed_out" ? 202 : 203;
        }
        finally
        {
            if (childInfo.hProcess != IntPtr.Zero)
            {
                if (!resumed) Native.TerminateProcess(childInfo.hProcess, 1);
                Native.CloseHandle(childInfo.hProcess);
            }
            if (childInfo.hThread != IntPtr.Zero) Native.CloseHandle(childInfo.hThread);
            if (input != IntPtr.Zero && input != new IntPtr(-1)) Native.CloseHandle(input);
            if (output != IntPtr.Zero) Native.CloseHandle(output);
            if (errorOutput != IntPtr.Zero) Native.CloseHandle(errorOutput);
            if (job != IntPtr.Zero) Native.CloseHandle(job);
        }
    }
}
