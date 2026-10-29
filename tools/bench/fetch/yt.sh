#!/bin/zsh
# Run yt-dlp from a source checkout.
#   YT_DLP_SRC  path to a yt-dlp source checkout (required)
#   YT_PYTHON   python interpreter (default: python3)
: "${YT_DLP_SRC:?set YT_DLP_SRC to your yt-dlp source checkout}"
export PYTHONPATH="$YT_DLP_SRC"
exec "${YT_PYTHON:-python3}" -m yt_dlp "$@"
