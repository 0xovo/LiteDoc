"""Animated ASCII startup sequence for LiteDoc CLI."""

import time
import sys

GRAY = "\033[90m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
RED = "\033[31m"
BOLD = "\033[1m"
RESET = "\033[0m"

frames = [
    # Frame 0: Initial PDF State
    [
        f" {GRAY}┌───────────────┐{RESET}",
        f" {GRAY}│{RESET} {RED}[PDF]{RESET}         {GRAY}│{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡≡≡≡≡≡≡ {GRAY}│{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡       {GRAY}│{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡≡≡≡≡≡≡ {GRAY}│{RESET}",
        f" {GRAY}└───────────────┘{RESET}"
    ],
    # Frame 1: Scanner moving down
    [
        f" {GRAY}┌───────────────┐{RESET}",
        f" {MAGENTA}│ ============= │{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡≡≡≡≡≡≡ {GRAY}│{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡       {GRAY}│{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡≡≡≡≡≡≡ {GRAY}│{RESET}",
        f" {GRAY}└───────────────┘{RESET}"
    ],
    # Frame 2: Markdown revealing
    [
        f" {GRAY}┌───────────────┐{RESET}",
        f" {GRAY}│{RESET} {CYAN}# markdown{RESET}    {GRAY}│{RESET}",
        f" {MAGENTA}│ ============= │{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡       {GRAY}│{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡≡≡≡≡≡≡ {GRAY}│{RESET}",
        f" {GRAY}└───────────────┘{RESET}"
    ],
    # Frame 3: Markdown revealing
    [
        f" {GRAY}┌───────────────┐{RESET}",
        f" {GRAY}│{RESET} {CYAN}# markdown{RESET}    {GRAY}│{RESET}",
        f" {GRAY}│{RESET} {CYAN}- paragraph{RESET}   {GRAY}│{RESET}",
        f" {MAGENTA}│ ============= │{RESET}",
        f" {GRAY}│{RESET} ≡≡≡≡≡≡≡≡≡≡≡≡≡ {GRAY}│{RESET}",
        f" {GRAY}└───────────────┘{RESET}"
    ],
    # Frame 4: Markdown revealing
    [
        f" {GRAY}┌───────────────┐{RESET}",
        f" {GRAY}│{RESET} {CYAN}# markdown{RESET}    {GRAY}│{RESET}",
        f" {GRAY}│{RESET} {CYAN}- paragraph{RESET}   {GRAY}│{RESET}",
        f" {GRAY}│{RESET} {CYAN}- bullet pt{RESET}   {GRAY}│{RESET}",
        f" {MAGENTA}│ ============= │{RESET}",
        f" {GRAY}└───────────────┘{RESET}"
    ],
    # Frame 5: Complete Markdown State
    [
        f" {GRAY}┌───────────────┐{RESET}",
        f" {GRAY}│{RESET} {CYAN}# markdown{RESET}    {GRAY}│{RESET}",
        f" {GRAY}│{RESET} {CYAN}- paragraph{RESET}   {GRAY}│{RESET}",
        f" {GRAY}│{RESET} {CYAN}- bullet pt{RESET}   {GRAY}│{RESET}",
        f" {GRAY}│{RESET} {CYAN}> quote{RESET}       {GRAY}│{RESET}",
        f" {GRAY}└───────────────┘{RESET}"
    ],
    # Frame 6: Shrinking layout
    [
        f"",
        f"     {GRAY}┌─────────┐{RESET}",
        f"     {GRAY}│{RESET} {CYAN}......{RESET}  {GRAY}│{RESET}",
        f"     {GRAY}│{RESET} {CYAN}...{RESET}     {GRAY}│{RESET}",
        f"     {GRAY}└─────────┘{RESET}",
        f""
    ],
    # Frame 7: Morphing into the litedoc logo
    [
        f"",
        f"",
        f"   {GRAY}({RESET} {BOLD}litedoc{MAGENTA}.xyz{RESET} {GRAY}){RESET}",
        f"",
        f"",
        f""
    ],
    # Frame 8: Fading out
    [
        f"",
        f"",
        f"   {GRAY}( litedoc.xyz ){RESET}",
        f"",
        f"",
        f""
    ]
]

def run_animation(show_prompt=True, stream=None):
    if stream is None:
        stream = sys.stdout
    try:
        # Hide cursor
        stream.write('\033[?25l')
        stream.flush()

        # Add a newline buffer
        stream.write('\n')

        # Loop through frames
        for i, frame in enumerate(frames):
            # If not the first frame, move cursor up 6 lines
            if i > 0:
                stream.write(f'\033[{len(frame)}A')

            # Draw the current frame line-by-line
            for line in frame:
                # \033[2K clears the current line entirely to prevent ghosting
                stream.write(f'\033[2K{line}\n')
            
            stream.flush()

            # Dynamic timing to match the React CSS keyframes
            if i == 0 or i == 5:
                delay = 0.5   # Pause on PDF and MD states
            elif i == len(frames) - 2:
                delay = 0.6   # Pause on Logo
            elif i == len(frames) - 1:
                delay = 0.2   # Quick fade out
            else:
                delay = 0.15  # Fast scanning/morphing speed
                
            time.sleep(delay)

        # Move up and erase the 6 lines of the animation space
        stream.write(f'\033[{len(frames[0])}A')
        for _ in range(len(frames[0])):
            stream.write('\033[2K\n')
        # Reset cursor back to top
        stream.write(f'\033[{len(frames[0])}A')
        
        # Move back up one line to eat the initial buffer
        stream.write('\033[1A\033[2K') 

        # Simulated CLI App Start
        stream.write(f"\n{MAGENTA}◆{RESET} {BOLD}litedoc.xyz{RESET} Local Engine initialized.\n")
        if show_prompt:
            stream.write(f"{GRAY}Ready to extract files.{RESET}\n\n")
            stream.write(f"{CYAN}>{RESET} _\n")
        else:
            stream.write(f"{GRAY}Ready to extract files.{RESET}\n")
        stream.flush()

    except KeyboardInterrupt:
        pass
    finally:
        # Always ensure the cursor is shown again before exiting
        stream.write('\033[?25h')
        stream.flush()

def animate():
    run_animation(show_prompt=True, stream=sys.stdout)

if __name__ == "__main__":
    animate()
