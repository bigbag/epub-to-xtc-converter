.PHONY: help

#################################################################################
# GLOBALS                                                                       #
#################################################################################

PROJECT_DIR := $(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))
PROJECT_NAME = xteink-epub-optimizer

CURRENT_PATH = $(shell pwd)

VENV := $(or ${VIRTUAL_ENV},${VIRTUAL_ENV},.venv)
PYTHON = $(VENV)/bin/python
PIP = $(VENV)/bin/pip
UV = $(VENV)/bin/uv

PYTHON_VERSION=3.12
PYTHONPATH := $(or ${PYTHONPATH},.)
TEST_DIR = tests/

LINT_SOURCES_PATHS = src/

export PYTHONPATH

#######################
### System commands
#######################
.PHONY: tag
## Create and push tag
tag:
	@read -p "Enter tag version (e.g., 1.0.0): " TAG; \
	if [[ $$TAG =~ ^[0-9]+\.[0-9]+\.[0-9]+$$ ]]; then \
		git tag -a $$TAG -m $$TAG; \
		git push origin $$TAG; \
		echo "Tag $$TAG created and pushed successfully."; \
	else \
		echo "Invalid tag format. Please use X.Y.Z (e.g., 1.0.0)"; \
		exit 1; \
	fi
#######################
### Virtual environment
#######################

.PHONY: venv/create
venv/create: ## Create virtual environment
	@echo "create virtual environment..."
	python -m venv ${VENV}
	@echo "done"
	@echo

.PHONY: venv/install/main
## Install main dependencies
venv/install/main:
	@echo "install virtual environment..."
	$(UV) sync --no-group dev

.PHONY: venv/install/all
## Install all dependencies
venv/install/all:
	@echo "install virtual environment..."
	$(UV) sync --all-groups

########################################
### EPUB Processing
########################################

.PHONY: optimize
## Optimize EPUBs for Xteink X4 (usage: make optimize INPUT=./input OUTPUT=./output)
optimize:
	$(PYTHON) src/optimizer.py $(INPUT) $(OUTPUT)

# Default font path for conversion
FONT ?= fonts/Bookerly.ttf
FONT_BOLD ?= fonts/Bookerly Bold.ttf
FONT_ITALIC ?= fonts/Bookerly Italic.ttf
FONT_BOLD_ITALIC ?= fonts/Bookerly Bold Italic.ttf
FONT_SIZE ?= 34

.PHONY: convert
## Convert EPUB to XTC/XTCH (usage: make convert INPUT=book.epub OUTPUT=book.xtch FONT_SIZE=40)
convert:
	$(PYTHON) src/converter.py $(INPUT) $(OUTPUT) \
		--font "$(FONT)" \
		--font-bold "$(FONT_BOLD)" \
		--font-italic "$(FONT_ITALIC)" \
		--font-bold-italic "$(FONT_BOLD_ITALIC)" \
		--font-size $(FONT_SIZE)

.PHONY: convert-mono
## Convert EPUB to XTC (1-bit mono) (usage: make convert-mono INPUT=book.epub OUTPUT=book.xtc)
convert-mono:
	$(PYTHON) src/converter.py $(INPUT) $(OUTPUT) --format xtc \
		--font "$(FONT)" \
		--font-bold "$(FONT_BOLD)" \
		--font-italic "$(FONT_ITALIC)" \
		--font-bold-italic "$(FONT_BOLD_ITALIC)" \
		--font-size $(FONT_SIZE)

########################################
### Code style & formatting tools
########################################

.PHONY: lint/black
lint/black:
	@echo "linting using black..."
	$(PYTHON) -m black --check --diff $(LINT_SOURCES_PATHS)
	@echo "done"
	@echo

.PHONY: lint/flake8
lint/flake8:
	@echo "linting using flake8..."
	$(PYTHON) -m flake8 $(LINT_SOURCES_PATHS)
	@echo "done"
	@echo

.PHONY: lint/isort
lint/isort:
	@echo "linting using isort..."
	$(PYTHON) -m isort --check-only --diff $(LINT_SOURCES_PATHS)
	@echo "done"
	@echo


.PHONY: lint
## Running all linters
lint: lint/black lint/flake8 lint/isort

.PHONY: format
## Formatting source code
format:
	@echo "formatting using black..."
	$(PYTHON) -m black $(LINT_SOURCES_PATHS)
	@echo "done"
	@echo "linting using isort..."
	$(PYTHON) -m isort $(LINT_SOURCES_PATHS)
	@echo "done"
	@echo

## Delete all compiled Python files
clean:  ## Clear temporary information
	@echo "Clear cache directories"
	rm -rf .mypy_cache .pytest_cache .coverage
	@rm -rf `find . -name __pycache__`
	@rm -rf `find . -type f -name '*.py[co]' `
	@rm -rf `find . -type f -name '*~' `
	@rm -rf `find . -type f -name '.*~' `
	@rm -rf `find . -type f -name '@*' `
	@rm -rf `find . -type f -name '#*#' `
	@rm -rf `find . -type f -name '*.orig' `
	@rm -rf `find . -type f -name '*.rej' `
	@rm -rf .coverage
	@rm -rf coverage.html
	@rm -rf coverage.xml
	@rm -rf htmlcov
	@rm -rf build
	@rm -rf cover
	@rm -rf .develop
	@rm -rf .flake
	@rm -rf .install-deps
	@rm -rf *.egg-info
	@rm -rf .pytest_cache
	@rm -rf .mypy_cache
	@rm -rf dist
	@rm -rf test-reports

####################
### Tests
####################

.PHONY: test
## Run all tests
test:
	PYTHONPATH=$(PYTHONPATH):src \
	$(PYTHON) -m pytest --disable-warnings $(TEST_DIR)


#################################################################################
# Self Documenting Commands                                                     #
#################################################################################

.DEFAULT_GOAL := help

# Inspired by <http://marmelab.com/blog/2016/02/29/auto-documented-makefile.html>
# sed script explained:
# /^##/:
# 	* save line in hold space
# 	* purge line
# 	* Loop:
# 		* append newline + line to hold space
# 		* go to next line
# 		* if line starts with doc comment, strip comment character off and loop
# 	* remove target prerequisites
# 	* append hold space (+ newline) to line
# 	* replace newline plus comments by `---`
# 	* print line
# Separate expressions are necessary because labels cannot be delimited by
# semicolon; see <http://stackoverflow.com/a/11799865/1968>
.PHONY: help
help:
	@echo "$$(tput bold)Available rules:$$(tput sgr0)"
	@echo
	@sed -n -e "/^## / { \
		h; \
		s/.*//; \
		:doc" \
		-e "H; \
		n; \
		s/^## //; \
		t doc" \
		-e "s/:.*//; \
		G; \
		s/\\n## /---/; \
		s/\\n/ /g; \
		p; \
	}" ${MAKEFILE_LIST} \
	| LC_ALL='C' sort --ignore-case \
	| awk -F '---' \
		-v ncol=$$(tput cols) \
		-v indent=19 \
		-v col_on="$$(tput setaf 6)" \
		-v col_off="$$(tput sgr0)" \
	'{ \
		printf "%s%*s%s ", col_on, -indent, $$1, col_off; \
		n = split($$2, words, " "); \
		line_length = ncol - indent; \
		for (i = 1; i <= n; i++) { \
			line_length -= length(words[i]) + 1; \
			if (line_length <= 0) { \
				line_length = ncol - indent - length(words[i]) - 1; \
				printf "\n%*s ", -indent, " "; \
			} \
			printf "%s ", words[i]; \
		} \
		printf "\n"; \
	}' \
	| more $(shell test $(shell uname) = Darwin && echo '--no-init --raw-control-chars')
