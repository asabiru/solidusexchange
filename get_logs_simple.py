import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
                look_for_keys=False, allow_agent=False, timeout=10)
    
    # Try a simpler approach - execute python on server to read the file
    cmd = "python3 -c \"print(open('/root/p2c-sniper-bot/logs/sniper.log').read()[-3000:])\""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    
    if out:
        print("=== LOGS ===")
        print(out)
    if err:
        print("=== ERR ===")
        print(err)
        
    ssh.close()
except Exception as e:
    print(f"Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()