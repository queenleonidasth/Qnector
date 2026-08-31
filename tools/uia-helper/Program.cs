using System.Text;
using System.Text.Json;
using System.Windows.Automation;

namespace Qnector.UiaHelper;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = null };

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length >= 2)
            {
                var action = args[0];
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
                using var document = JsonDocument.Parse(json);
                WriteResult(Execute(action, document.RootElement));
                return 0;
            }

            string? line;
            while ((line = Console.ReadLine()) is not null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    using var document = JsonDocument.Parse(line);
                    var root = document.RootElement;
                    var action = root.GetProperty("action").GetString() ?? throw new Exception("INVALID_INPUT: action is required");
                    var input = root.TryGetProperty("input", out var inputElement) ? inputElement : default;
                    Console.WriteLine(JsonSerializer.Serialize(new { ok = true, result = Execute(action, input) }, JsonOptions));
                }
                catch (Exception error)
                {
                    Console.WriteLine(JsonSerializer.Serialize(new { ok = false, error = error.Message }, JsonOptions));
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static object Execute(string action, JsonElement input)
    {
        if (action == "windows")
        {
            var max = Int(input, "maxResults", 100);
            var rows = new List<Row>();
            var all = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement windowElement in all)
            {
                if (rows.Count >= max) break;
                var row = ToRow(windowElement, "", 0);
                if (row is not null && !string.IsNullOrWhiteSpace(row.Name)) rows.Add(row);
            }
            return rows;
        }

        var processId = Int(input, "processId", 0);
        if (action == "window_for_pid") return ToRow(FindWindow(processId, ""), "", 0)!;
        var windowRid = String(input, "windowRuntimeId");
        var window = FindWindow(processId, windowRid);

        if (action == "inspect")
            return Inspect(window, Int(input, "depth", 4), Int(input, "maxResults", 300));
        if (action == "find")
            return Find(window, input, Int(input, "maxResults", 50));

        var runtimeId = String(input, "runtimeId");
        var element = FindElement(window, runtimeId);
        if (!element.Current.IsEnabled) throw new Exception("UIA_ACTION_UNSUPPORTED: element is disabled");

        switch (action)
        {
            case "invoke":
                RequirePattern<InvokePattern>(element, InvokePattern.Pattern, "InvokePattern").Invoke();
                break;
            case "set_value":
            {
                var pattern = RequirePattern<ValuePattern>(element, ValuePattern.Pattern, "ValuePattern");
                if (pattern.Current.IsReadOnly) throw new Exception("UIA_ACTION_UNSUPPORTED: element value is read-only");
                pattern.SetValue(String(input, "value"));
                break;
            }
            case "focus":
                try { element.SetFocus(); } catch { throw new Exception("UIA_ACCESS_DENIED: could not focus UI element"); }
                break;
            case "select":
                RequirePattern<SelectionItemPattern>(element, SelectionItemPattern.Pattern, "SelectionItemPattern").Select();
                break;
            case "toggle":
                RequirePattern<TogglePattern>(element, TogglePattern.Pattern, "TogglePattern").Toggle();
                break;
            case "expand":
                RequirePattern<ExpandCollapsePattern>(element, ExpandCollapsePattern.Pattern, "ExpandCollapsePattern").Expand();
                break;
            case "collapse":
                RequirePattern<ExpandCollapsePattern>(element, ExpandCollapsePattern.Pattern, "ExpandCollapsePattern").Collapse();
                break;
            case "scroll_into_view":
                RequirePattern<ScrollItemPattern>(element, ScrollItemPattern.Pattern, "ScrollItemPattern").ScrollIntoView();
                break;
            case "range_value":
            {
                var pattern = RequirePattern<RangeValuePattern>(element, RangeValuePattern.Pattern, "RangeValuePattern");
                if (pattern.Current.IsReadOnly) throw new Exception("UIA_ACTION_UNSUPPORTED: range value is read-only");
                var value = Double(input, "numberValue");
                if (value < pattern.Current.Minimum || value > pattern.Current.Maximum)
                    throw new Exception($"INVALID_INPUT: range value must be between {pattern.Current.Minimum} and {pattern.Current.Maximum}");
                pattern.SetValue(value);
                break;
            }
            default:
                throw new Exception($"INVALID_INPUT: unknown UI Automation action {action}");
        }

        Thread.Sleep(40);
        return ToRow(element, "", 0) ?? throw new Exception("ELEMENT_STALE: UI element no longer exists");
    }

    private static List<Row> Inspect(AutomationElement window, int maxDepth, int maxResults)
    {
        var output = new List<Row>();
        var walker = TreeWalker.ControlViewWalker;
        void Visit(AutomationElement node, string parentRid, int depth)
        {
            if (depth > maxDepth || output.Count >= maxResults) return;
            AutomationElement? child;
            try { child = walker.GetFirstChild(node); } catch { return; }
            while (child is not null && output.Count < maxResults)
            {
                var row = ToRow(child, parentRid, depth);
                if (row is not null) output.Add(row);
                if (depth < maxDepth) Visit(child, RuntimeId(child), depth + 1);
                try { child = walker.GetNextSibling(child); } catch { child = null; }
            }
        }
        Visit(window, RuntimeId(window), 1);
        return output;
    }

    private static List<Row> Find(AutomationElement window, JsonElement input, int maxResults)
    {
        var output = new List<Row>();
        var all = window.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        foreach (AutomationElement element in all)
        {
            if (output.Count >= maxResults) break;
            try
            {
                var controlType = element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "");
                if (!Matches(element.Current.Name, String(input, "name"), true)) continue;
                if (!Matches(element.Current.AutomationId, String(input, "automationId"), false)) continue;
                if (!Matches(controlType, String(input, "controlType"), false)) continue;
                if (!Matches(element.Current.ClassName, String(input, "className"), false)) continue;
                var row = ToRow(element, "", 0);
                if (row is not null) output.Add(row);
            }
            catch { }
        }
        return output;
    }

    private static AutomationElement FindWindow(int processId, string runtimeId)
    {
        var all = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
        foreach (AutomationElement element in all)
        {
            try
            {
                if (element.Current.ProcessId == processId && (string.IsNullOrEmpty(runtimeId) || RuntimeId(element) == runtimeId))
                    return element;
            }
            catch { }
        }
        throw new Exception("UIA_WINDOW_NOT_FOUND: target window is no longer available");
    }

    private static AutomationElement FindElement(AutomationElement window, string runtimeId)
    {
        if (RuntimeId(window) == runtimeId) return window;
        var all = window.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        foreach (AutomationElement element in all)
            if (RuntimeId(element) == runtimeId) return element;
        throw new Exception("ELEMENT_STALE: UI element is no longer available");
    }

    private static T RequirePattern<T>(AutomationElement element, AutomationPattern pattern, string name) where T : BasePattern
    {
        if (!element.TryGetCurrentPattern(pattern, out var value) || value is not T typed)
            throw new Exception($"UIA_ACTION_UNSUPPORTED: element does not support {name}");
        return typed;
    }

    private static Row? ToRow(AutomationElement element, string parentRuntimeId, int depth)
    {
        try
        {
            var rectangle = element.Current.BoundingRectangle;
            return new Row
            {
                RuntimeId = RuntimeId(element),
                ParentRuntimeId = parentRuntimeId,
                Depth = depth,
                Name = element.Current.Name ?? "",
                AutomationId = element.Current.AutomationId ?? "",
                ControlType = element.Current.ControlType.ProgrammaticName,
                ClassName = element.Current.ClassName ?? "",
                ProcessId = element.Current.ProcessId,
                Enabled = element.Current.IsEnabled,
                Offscreen = element.Current.IsOffscreen,
                Focusable = element.Current.IsKeyboardFocusable,
                Value = ReadValue(element),
                Patterns = SupportedPatterns(element),
                X = Finite(rectangle.X),
                Y = Finite(rectangle.Y),
                Width = Finite(rectangle.Width),
                Height = Finite(rectangle.Height),
            };
        }
        catch { return null; }
    }

    private static double Finite(double value)
        => double.IsFinite(value) ? value : 0d;

    private static string? ReadValue(AutomationElement element)
    {
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern) && pattern is ValuePattern value) return value.Current.Value;
            if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out var rangePattern) && rangePattern is RangeValuePattern range) return range.Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        catch { }
        return null;
    }

    private static string[] SupportedPatterns(AutomationElement element)
    {
        try
        {
            return element.GetSupportedPatterns().Select(pattern => pattern.ProgrammaticName.Replace("PatternIdentifiers.Pattern", "")).ToArray();
        }
        catch { return Array.Empty<string>(); }
    }

    private static string RuntimeId(AutomationElement element)
    {
        try { return string.Join('.', element.GetRuntimeId()); } catch { return ""; }
    }

    private static bool Matches(string? actual, string expected, bool contains)
    {
        if (string.IsNullOrWhiteSpace(expected)) return true;
        actual ??= "";
        return contains
            ? actual.Contains(expected, StringComparison.OrdinalIgnoreCase)
            : string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
    }

    private static int Int(JsonElement input, string name, int fallback)
        => input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var value) && value.TryGetInt32(out var result) ? result : fallback;

    private static double Double(JsonElement input, string name)
    {
        if (input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var value) && value.TryGetDouble(out var result)) return result;
        throw new Exception($"INVALID_INPUT: {name} must be a number");
    }

    private static string String(JsonElement input, string name)
        => input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    private static void WriteResult(object result)
        => Console.Write(JsonSerializer.Serialize(result, JsonOptions));

    private sealed class Row
    {
        public string RuntimeId { get; init; } = "";
        public string ParentRuntimeId { get; init; } = "";
        public int Depth { get; init; }
        public string Name { get; init; } = "";
        public string AutomationId { get; init; } = "";
        public string ControlType { get; init; } = "";
        public string ClassName { get; init; } = "";
        public int ProcessId { get; init; }
        public bool Enabled { get; init; }
        public bool Offscreen { get; init; }
        public bool Focusable { get; init; }
        public string? Value { get; init; }
        public string[] Patterns { get; init; } = Array.Empty<string>();
        public double X { get; init; }
        public double Y { get; init; }
        public double Width { get; init; }
        public double Height { get; init; }
    }
}
