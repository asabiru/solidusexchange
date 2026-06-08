import paramiko

host = '82.27.201.169'
port = 22
username = 'root'
password = '09087691aA!'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, port=port, username=username, password=password,
            look_for_keys=False, allow_agent=False, timeout=15)

sftp = ssh.open_sftp()

# Upload modified files
sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\main.py',
    '/root/p2c-sniper-bot/main.py'
)
print('Uploaded main.py')

sftp.put(
    r'C:\Users\Владелец\Desktop\solidusexchange-main\p2c-sniper-bot\sniper.py',
    '/root/p2c-sniper-bot/sniper.py'
)
print('Uploaded sniper.py')

sftp.close()

# Restart the bot
stdin, stdout, stderr = ssh.exec_command('cd /root/p2c-sniper-bot && pkill -f "python3 main.py" && sleep 2 && nohup venv/bin/python3 main.py > logs/bot_stdout.log 2>&1 & echo "Restarted"')
print(stdout.read().decode().strip())
err = stderr.read().decode()
if err.strip():
    print('ERR:', err)

ssh.close()
