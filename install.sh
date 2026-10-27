#!/usr/bin/env sh
# Install threejs-skills with the open skills CLI (https://skills.sh), for any supported agent.
# A thin wrapper over "npx skills add" that adds profiles from profiles.json and the optional
# external img2threejs skill. Arguments after "--" go to "npx skills add" unchanged.
#
#   ./install.sh                           # all skills, user scope; the CLI asks which agents
#   ./install.sh --profile models          # one profile: models, foundations or create (repeatable)
#   ./install.sh --with-img2threejs        # also install img2threejs/img2threejs
#   ./install.sh --project                 # into the directory you run it from instead of user scope
#   ./install.sh --local                   # use this checkout as the source instead of GitHub
#   ./install.sh -- --agent codex --yes    # flags after -- go to every npx skills add call
#   ./install.sh --dry-run                 # print the commands without running them
#
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
SOURCE="emiliodominguez/threejs-skills"
SKILLS_CLI="skills@1"
SCOPE="-g"
SKILLS=""
EXTERNAL=0
DRY_RUN=0

say() { printf '\033[36m›\033[0m %s\n' "$1"; }
die() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

profile_skills() {
	node -e '
		const [file, name] = process.argv.slice(1);
		const profiles = require(file).profiles ?? {};
		if (!profiles[name]) { console.error("Unknown profile \"" + name + "\". Known: " + Object.keys(profiles).join(", ")); process.exit(1); }
		console.log(profiles[name].join(" "));
	' "$ROOT/profiles.json" "$1"
}

run() {
	say "npx $*"
	[ "$DRY_RUN" = 1 ] || npx -y "$@"
}

while [ $# -gt 0 ]; do
	case "$1" in
		--profile)
			[ $# -ge 2 ] || die "--profile needs a name"
			SKILLS="$SKILLS $(profile_skills "$2")" || exit 1
			shift 2
			;;
		--with-img2threejs) EXTERNAL=1 && shift ;;
		--project) SCOPE="" && shift ;;
		--local) SOURCE="$ROOT" && shift ;;
		--dry-run) DRY_RUN=1 && shift ;;
		--) shift && break ;;
		-h | --help) sed -n '2,13p' "$0" && exit 0 ;;
		*) die "Unknown option $1 (pass skills CLI flags after --)" ;;
	esac
done

command -v npx >/dev/null 2>&1 || die "Node.js and npx are required. Install Node.js 24+ and re-run."

# Agent, scope and prompt flags after "--" apply to every install, including img2threejs.
# Kept as a word-split string: skills CLI flags and agent names contain no spaces.
PASSTHROUGH="$*"

set -- "$SKILLS_CLI" add "$SOURCE" $SCOPE "$@"
if [ -n "$SKILLS" ]; then
	# Profiles overlap; install each skill once.
	set -- "$@" --skill $(printf '%s\n' $SKILLS | sort -u)
fi
run "$@"

if [ "$EXTERNAL" = 1 ]; then
	# shellcheck disable=SC2086
	run "$SKILLS_CLI" add img2threejs/img2threejs $SCOPE $PASSTHROUGH
fi
