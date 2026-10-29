Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(scriptDir, "run_streamx_service.bat")

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c """ & batPath & """", 0, False
