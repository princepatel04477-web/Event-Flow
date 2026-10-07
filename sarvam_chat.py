import os
from pathlib import Path

from sarvamai import SarvamAI

# Load SARVAM_API_KEY from .env next to this file, unless it is already set in the environment.
env_file = Path(__file__).with_name(".env")
if env_file.exists():
    for line in env_file.read_text().splitlines():
        name, sep, value = line.partition("=")
        if sep and name.strip() == "SARVAM_API_KEY" and not os.environ.get("SARVAM_API_KEY"):
            os.environ["SARVAM_API_KEY"] = value.strip().strip('"').strip("'")

api_key = os.environ.get("SARVAM_API_KEY")
if not api_key:
    raise SystemExit("SARVAM_API_KEY is empty. Paste your key into .env and run again.")

client = SarvamAI(api_subscription_key=api_key)

response = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "Say hello in Hindi and English, in one short line."}],
)

print(response.choices[0].message.content)
