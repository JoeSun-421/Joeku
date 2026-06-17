' Joeku launcher — reliable double-click entry (no cmd encoding issues)
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run "cmd /c """ & root & "\Joeku.bat""", 1, False