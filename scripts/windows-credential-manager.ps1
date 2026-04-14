param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Get", "Set", "Delete", "GetMany", "SetMany", "DeleteMany")]
  [string]$Action,

  [string]$Target = "",

  [string]$Username = "israeli-bank-ynab-transformer",
  [string]$Secret = "",
  [string]$ItemsJson = "[]"
)

$ErrorActionPreference = "Stop"

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CredentialNative
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public UInt32 Flags;
        public UInt32 Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL userCredential, UInt32 flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr credentialPtr);

    public static bool WriteCredential(string target, string username, string secret)
    {
        byte[] secretBytes = Encoding.Unicode.GetBytes(secret ?? string.Empty);
        IntPtr secretPtr = IntPtr.Zero;

        try
        {
            if (secretBytes.Length > 0)
            {
                secretPtr = Marshal.AllocCoTaskMem(secretBytes.Length);
                Marshal.Copy(secretBytes, 0, secretPtr, secretBytes.Length);
            }

            CREDENTIAL credential = new CREDENTIAL();
            credential.TargetName = target;
            credential.Type = 1; // CRED_TYPE_GENERIC
            credential.UserName = username;
            credential.CredentialBlobSize = (UInt32)secretBytes.Length;
            credential.CredentialBlob = secretPtr;
            credential.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE

            return CredWrite(ref credential, 0);
        }
        finally
        {
            if (secretPtr != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(secretPtr);
            }
        }
    }

    public static string ReadCredential(string target)
    {
        IntPtr credentialPtr;
        bool read = CredRead(target, 1, 0, out credentialPtr); // CRED_TYPE_GENERIC
        if (!read)
        {
            return null;
        }

        try
        {
            CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
            {
                return string.Empty;
            }

            byte[] secretBytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, secretBytes, 0, (int)credential.CredentialBlobSize);
            return Encoding.Unicode.GetString(secretBytes).TrimEnd('\0');
        }
        finally
        {
            CredFree(credentialPtr);
        }
    }

    public static bool DeleteCredential(string target)
    {
        return CredDelete(target, 1, 0); // CRED_TYPE_GENERIC
    }
}
"@

function Throw-IfWin32Failed {
  param([string]$Message)
  $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "$Message (Win32 error: $code)"
}

switch ($Action) {
  "Get" {
    if (-not $Target) {
      throw "Target is required for Get action."
    }
    $value = [CredentialNative]::ReadCredential($Target)
    if ($null -eq $value) {
      [Console]::Out.Write("")
      exit 0
    }
    [Console]::Out.Write($value)
    exit 0
  }
  "Set" {
    if (-not $Target) {
      throw "Target is required for Set action."
    }
    $ok = [CredentialNative]::WriteCredential($Target, $Username, $Secret)
    if (-not $ok) {
      Throw-IfWin32Failed -Message "Failed to write credential for target '$Target'"
    }
    exit 0
  }
  "Delete" {
    if (-not $Target) {
      throw "Target is required for Delete action."
    }
    $ok = [CredentialNative]::DeleteCredential($Target)
    if (-not $ok) {
      $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($code -ne 1168) {
        throw "Failed to delete credential for target '$Target' (Win32 error: $code)"
      }
    }
    exit 0
  }
  "GetMany" {
    $targets = @()
    if ($ItemsJson) {
      $targets = @((ConvertFrom-Json -InputObject $ItemsJson))
    }
    $result = @{}
    foreach ($item in $targets) {
      $targetName = [string]$item
      $value = [CredentialNative]::ReadCredential($targetName)
      if ($null -eq $value) {
        $result[$targetName] = ""
      } else {
        $result[$targetName] = $value
      }
    }
    [Console]::Out.Write(($result | ConvertTo-Json -Compress))
    exit 0
  }
  "SetMany" {
    $items = @()
    if ($ItemsJson) {
      $items = @((ConvertFrom-Json -InputObject $ItemsJson))
    }

    foreach ($item in $items) {
      $targetName = [string]$item.target
      $usernameValue = [string]$item.username
      $secretValue = [string]$item.secret
      $ok = [CredentialNative]::WriteCredential($targetName, $usernameValue, $secretValue)
      if (-not $ok) {
        Throw-IfWin32Failed -Message "Failed to write credential for target '$targetName'"
      }
    }
    exit 0
  }
  "DeleteMany" {
    $targets = @()
    if ($ItemsJson) {
      $targets = @((ConvertFrom-Json -InputObject $ItemsJson))
    }

    foreach ($item in $targets) {
      $targetName = [string]$item
      $ok = [CredentialNative]::DeleteCredential($targetName)
      if (-not $ok) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -ne 1168) {
          throw "Failed to delete credential for target '$targetName' (Win32 error: $code)"
        }
      }
    }
    exit 0
  }
}
