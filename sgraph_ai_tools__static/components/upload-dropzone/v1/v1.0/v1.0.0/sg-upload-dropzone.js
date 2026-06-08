/* =================================================================================
   SGraph — Upload Dropzone Component
   v1.0.0 — Drag-and-drop file upload zone with visual feedback

   Usage:
     <script type="module" src="/components/upload-dropzone/v1/v1.0/v1.0.0/sg-upload-dropzone.js"></script>

     <sg-upload-dropzone accept=".pdf,.doc" max-size="10485760" multiple>
     </sg-upload-dropzone>

   Attributes:
     accept    — Comma-separated MIME types or extensions (default: "*")
     multiple  — Allow multiple file selection (boolean)
     max-size  — Max file size in bytes, 0 = no limit (default: 0)
     disabled  — Disable interaction (boolean)
     label     — Custom prompt text

   Events:
     files-selected — { files: File[] } — User selects files via click or drop
     file-dropped   — { file, name, size, type } — Per-file event on drop
     file-rejected  — { file, reason } — File exceeds max-size or wrong type

   Slots:
     (default)  — Custom content replaces default drop prompt
     icon       — Custom icon (default: upload arrow SVG)
   ================================================================================= */

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

class SgUploadDropzone extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-upload-dropzone' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        this._renderLabel()
        this._syncInputAttrs()
        this._updateState('idle')
    }

    // Mirror `accept` and `multiple` onto the inner <input> BEFORE the picker
    // opens. Without this, iOS Safari opens a bare picker and may grey out
    // valid media (notably HEVC .MOV from the Photos library).
    _syncInputAttrs() {
        const accept = this.getAttribute('accept')
        if (accept) {
            this._fileInput.setAttribute('accept', accept)
        } else {
            this._fileInput.removeAttribute('accept')
        }
        if (this.hasAttribute('multiple')) {
            this._fileInput.setAttribute('multiple', '')
        } else {
            this._fileInput.removeAttribute('multiple')
        }
    }

    bindElements() {
        this._dropzone    = this.$('.dropzone')
        this._fileInput   = this.$('#file-input')
        this._promptArea  = this.$('.dropzone__prompt')
        this._fileInfo    = this.$('.dropzone__file-info')
        this._fileName    = this.$('.dropzone__file-name')
        this._fileSize    = this.$('.dropzone__file-size')
        this._changeBtn   = this.$('.dropzone__change-btn')
        this._labelEl     = this.$('.dropzone__label')
        this._dragOverlay = this.$('.dropzone__drag-overlay')
    }

    setupEventListeners() {
        this.addTrackedListener(this._dropzone, 'click', this._onClick)
        this.addTrackedListener(this._dropzone, 'dragover', this._onDragOver)
        this.addTrackedListener(this._dropzone, 'dragleave', this._onDragLeave)
        this.addTrackedListener(this._dropzone, 'drop', this._onDrop)
        this.addTrackedListener(this._fileInput, 'change', this._onFileInputChange)
        this.addTrackedListener(this._changeBtn, 'click', this._onChangeFile)
    }

    // --- Rendering ---------------------------------------------------------------

    _renderLabel() {
        const label = this.getAttribute('label') || 'Drop a file here or click to select'
        this._labelEl.textContent = label
    }

    _updateState(state) {
        this._dropzone.setAttribute('data-state', state)
    }

    // --- Event Handlers ----------------------------------------------------------

    _onClick(e) {
        if (this.hasAttribute('disabled')) return
        if (e.target === this._changeBtn) return
        this._fileInput.click()
    }

    _onDragOver(e) {
        e.preventDefault()
        e.stopPropagation()
        if (this.hasAttribute('disabled')) return
        this._updateState('drag-over')
    }

    _onDragLeave(e) {
        e.preventDefault()
        e.stopPropagation()
        if (this._currentFile) {
            this._updateState('file-loaded')
        } else {
            this._updateState('idle')
        }
    }

    _onDrop(e) {
        e.preventDefault()
        e.stopPropagation()
        if (this.hasAttribute('disabled')) return

        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return

        this._processFiles(files)
    }

    _onFileInputChange() {
        const files = Array.from(this._fileInput.files)
        if (files.length === 0) return
        this._processFiles(files)
        this._fileInput.value = ''
    }

    _onChangeFile(e) {
        e.stopPropagation()
        this._fileInput.click()
    }

    // --- File Processing ---------------------------------------------------------

    /**
     * Process selected files — validate, display, emit events.
     * @param {File[]} files
     */
    _processFiles(files) {
        const accept   = this.getAttribute('accept') || '*'
        const maxSize  = parseInt(this.getAttribute('max-size') || '0', 10)
        const multiple = this.hasAttribute('multiple')

        if (!multiple) {
            files = [files[0]]
        }

        const accepted = []
        for (const file of files) {
            if (maxSize > 0 && file.size > maxSize) {
                this.emit('file-rejected', {
                    file,
                    reason: `File too large (max ${this._formatSize(maxSize)})`
                })
                continue
            }
            if (accept !== '*' && !this._matchesAccept(file, accept)) {
                this.emit('file-rejected', { file, reason: 'File type not accepted' })
                continue
            }
            accepted.push(file)
        }

        if (accepted.length === 0) return

        this._currentFile = accepted[0]
        this._fileName.textContent = accepted[0].name
        this._fileSize.textContent = this._formatSize(accepted[0].size)
        this._updateState('file-loaded')

        for (const file of accepted) {
            this.emit('file-dropped', {
                file,
                name: file.name,
                size: file.size,
                type: file.type
            })
        }

        this.emit('files-selected', { files: accepted })
    }

    /**
     * Check if a file matches the accept attribute.
     * @param {File} file
     * @param {string} accept
     * @returns {boolean}
     */
    _matchesAccept(file, accept) {
        if (!accept || accept === '*') return true
        const patterns = accept.split(',').map(p => p.trim().toLowerCase())
        const fileName = file.name.toLowerCase()
        const fileType = file.type.toLowerCase()

        return patterns.some(pattern => {
            if (pattern.startsWith('.')) {
                return fileName.endsWith(pattern)
            }
            if (pattern.endsWith('/*')) {
                return fileType.startsWith(pattern.slice(0, -1))
            }
            return fileType === pattern
        })
    }

    /**
     * Format file size in human-readable form.
     * @param {number} bytes
     * @returns {string}
     */
    _formatSize(bytes) {
        if (bytes === 0) return '0 B'
        const units = ['B', 'KB', 'MB', 'GB']
        const k = 1024
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        const val = bytes / Math.pow(k, i)
        return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
    }

    // --- Public API --------------------------------------------------------------

    /**
     * Get the currently selected file.
     * @returns {File|null}
     */
    get selectedFile() {
        return this._currentFile || null
    }

    /**
     * Reset the dropzone to idle state.
     */
    reset() {
        this._currentFile = null
        this._updateState('idle')
        this._fileInput.value = ''
    }

    // --- Attribute Change ---------------------------------------------------------

    static get observedAttributes() {
        return ['label', 'accept', 'multiple', 'disabled']
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (!this._isReady || oldVal === newVal) return
        if (name === 'label') this._renderLabel()
        if (name === 'accept' || name === 'multiple') this._syncInputAttrs()
    }
}

customElements.define('sg-upload-dropzone', SgUploadDropzone)

export { SgUploadDropzone }
