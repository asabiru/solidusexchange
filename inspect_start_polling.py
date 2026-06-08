import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

script = '''
import asyncio
from aiogram import Bot, Dispatcher
from aiogram.dispatcher.dispatcher import Dispatcher as D
import inspect

# Check if start_polling is a coroutine or a regular function
print("start_polling is coroutine:", asyncio.iscoroutinefunction(D.start_polling))

# Print source of start_polling (first 50 lines)
source = inspect.getsource(D.start_polling)
for i, line in enumerate(source.splitlines()[:50]):
    print(f"{i+1}: {line}")
'''

stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && venv/bin/python3 -u -c \'\'\'' + script + '\'\'\' 2>&1'
)
out = stdout.read().decode()
err = stderr.read().decode()

print('STDOUT:')
print(out)
print('STDERR:')
print(err)

ssh.close()
