import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('82.27.201.169', port=22, username='root', password='09087691aA!',
            look_for_keys=False, allow_agent=False, timeout=15)

script = '''
import asyncio
from aiogram import Bot, Dispatcher

bot = Bot(token="test")
dp = Dispatcher()

async def test():
    print("Before start_polling")
    try:
        await dp.start_polling(bot)
    except Exception as e:
        print(f"Exception: {type(e).__name__}: {e}")
        raise
    print("After start_polling")

asyncio.run(test())
'''

stdin, stdout, stderr = ssh.exec_command(
    'cd /root/p2c-sniper-bot && venv/bin/python3 -u -c \'\'\'import asyncio; from aiogram import Bot, Dispatcher; bot = Bot(token="test"); dp = Dispatcher(); async def test(): print("Before"); await dp.start_polling(bot); print("After"); asyncio.run(test())\'\'\' 2>&1; echo "EXIT=$?"'
, timeout=15)

out = stdout.read().decode()
err = stderr.read().decode()

print('STDOUT:', out)
print('STDERR:', err)

ssh.close()
