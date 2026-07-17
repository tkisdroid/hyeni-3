using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class SofficeBridge
{
    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.GetEncoding(949);
        string outDir = null;
        string inputPath = null;
        for (var index = 0; index < args.Length; index += 1)
        {
            if (args[index] == "--outdir" && index + 1 < args.Length)
            {
                outDir = args[++index];
                continue;
            }
            if (File.Exists(args[index])) inputPath = args[index];
        }

        if (string.IsNullOrWhiteSpace(outDir) || string.IsNullOrWhiteSpace(inputPath))
        {
            Console.Error.WriteLine("Word bridge requires --outdir and an input document.");
            return 2;
        }

        var resolvedInput = Path.GetFullPath(inputPath);
        var resolvedOutput = Path.GetFullPath(outDir);
        Directory.CreateDirectory(resolvedOutput);
        var pdfPath = Path.Combine(
            resolvedOutput,
            Path.GetFileNameWithoutExtension(resolvedInput) + ".pdf"
        );

        object wordObject = null;
        object documentObject = null;
        try
        {
            var wordType = Type.GetTypeFromProgID("Word.Application", true);
            wordObject = Activator.CreateInstance(wordType);
            dynamic word = wordObject;
            word.Visible = false;
            word.DisplayAlerts = 0;
            word.AutomationSecurity = 3;
            documentObject = word.Documents.Open(
                resolvedInput,
                ConfirmConversions: false,
                ReadOnly: true,
                AddToRecentFiles: false,
                Visible: false,
                OpenAndRepair: true,
                NoEncodingDialog: true
            );
            dynamic document = documentObject;
            document.ExportAsFixedFormat(pdfPath, 17);
            Console.WriteLine("converted");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        finally
        {
            try { if (documentObject != null) ((dynamic)documentObject).Close(false); } catch { }
            try { if (wordObject != null) ((dynamic)wordObject).Quit(); } catch { }
            if (documentObject != null) Marshal.FinalReleaseComObject(documentObject);
            if (wordObject != null) Marshal.FinalReleaseComObject(wordObject);
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }
    }
}
