window.__ModuleLoader__.load({
  id: '@runzhliu/dsh-workspace-browser',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    const zh = window.navigator.language.toLowerCase().startsWith('zh')
    const messages = {
      binary: zh ? '二进制文件不提供文本预览' : 'Binary files are not shown as text',
      cancel: zh ? '取消' : 'Cancel',
      close: zh ? '关闭' : 'Close',
      createDirectory: zh ? '新建目录' : 'New folder',
      createDirectoryPrompt: zh ? '目录名称' : 'Folder name',
      createFile: zh ? '新建文件' : 'New file',
      createFilePrompt: zh ? '文件名称' : 'File name',
      delete: zh ? '删除' : 'Delete',
      deleteDirectoryConfirm: zh ? '确定删除目录“{name}”及其中所有内容吗？此操作不可撤销。' : 'Delete “{name}” and everything inside it? This cannot be undone.',
      deleteFileConfirm: zh ? '确定删除“{name}”吗？此操作不可撤销。' : 'Delete “{name}”? This cannot be undone.',
      discard: zh ? '当前文件有未保存修改，确定放弃吗？' : 'Discard the unsaved changes to this file?',
      empty: zh ? '目录为空' : 'This directory is empty',
      error: zh ? '读取工作区失败' : 'Unable to read the workspace',
      files: zh ? '文件' : 'Files',
      invalidName: zh ? '名称不能为空，也不能包含 /、\\、空字节，或使用 . 和 ..。' : 'Names cannot be empty, contain /, \\, or null bytes, or be . or ...',
      loading: zh ? '加载中…' : 'Loading…',
      modified: zh ? '修改时间' : 'Modified',
      open: zh ? '打开文件浏览器' : 'Open file browser',
      preview: zh ? '预览' : 'Preview',
      rename: zh ? '重命名' : 'Rename',
      renamePrompt: zh ? '新名称' : 'New name',
      refresh: zh ? '刷新' : 'Refresh',
      root: zh ? '工作区' : 'Workspace',
      save: zh ? '保存' : 'Save',
      saving: zh ? '保存中…' : 'Saving…',
      select: zh ? '选择文件以预览内容' : 'Select a file to preview it',
      size: zh ? '大小' : 'Size',
      symlink: zh ? '符号链接' : 'Symbolic link',
      truncated: zh ? '预览已截断，不能直接编辑' : 'Preview truncated; editing is disabled',
      workspace: zh ? '工作区文件' : 'Workspace files'
    }

    let overlayState = { opened: false }
    const listeners = new Set()

    function updateOverlayState(patch) {
      overlayState = { ...overlayState, ...patch }
      for (const listener of listeners) listener()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function useOverlayState() {
      return React.useSyncExternalStore(subscribe, () => overlayState, () => overlayState)
    }

    async function fetchJson(url, options = {}) {
      const response = await fetch(url, { cache: 'no-store', ...options })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `${messages.error} (HTTP ${response.status})`)
      return body
    }

    function mutateJson(url, method, body) {
      return fetchJson(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    }

    function formatBytes(value) {
      if (!Number.isFinite(value)) return '—'
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
      if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
      return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`
    }

    function parentPath(value) {
      const segments = value.split('/').filter(Boolean)
      segments.pop()
      return segments.join('/')
    }

    function childPath(parent, name) {
      return parent ? `${parent}/${name}` : name
    }

    function validName(value) {
      return value.length > 0 && value !== '.' && value !== '..' && !/[\\/\0]/.test(value)
    }

    function confirmDiscard(dirty) {
      return !dirty || window.confirm(messages.discard)
    }

    function WorkspaceButton({ wide }) {
      return React.createElement(
        'button',
        {
          type: 'button',
          title: messages.open,
          'aria-label': messages.open,
          onClick: () => updateOverlayState({ opened: true }),
          style: {
            boxSizing: 'border-box',
            width: wide ? '100%' : '36px',
            height: '36px',
            margin: '2px 0',
            padding: wide ? '0 12px' : '0',
            border: 0,
            borderRadius: '10px',
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: wide ? 'flex-start' : 'center',
            gap: '9px',
            fontSize: '14px'
          }
        },
        React.createElement('span', { style: { fontSize: '18px', lineHeight: 1 } }, '📁'),
        wide ? React.createElement('span', null, messages.files) : null
      )
    }

    function ToolbarButton({ children, onClick, disabled, title }) {
      return React.createElement(
        'button',
        {
          type: 'button',
          onClick,
          disabled,
          title,
          style: {
            minHeight: '30px',
            padding: '0 10px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: '8px',
            background: 'var(--dsw-alias-button-elevated-fill)',
            color: 'var(--dsw-alias-label-primary)',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            whiteSpace: 'nowrap'
          }
        },
        children
      )
    }

    function Breadcrumbs({ currentPath, onNavigate }) {
      const segments = currentPath.split('/').filter(Boolean)
      const crumbs = [{ label: messages.root, path: '' }]
      let accumulated = ''
      for (const segment of segments) {
        accumulated = accumulated ? `${accumulated}/${segment}` : segment
        crumbs.push({ label: segment, path: accumulated })
      }
      return React.createElement(
        'nav',
        {
          'aria-label': messages.workspace,
          style: {
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            overflowX: 'auto',
            fontSize: '13px'
          }
        },
        crumbs.flatMap((crumb, index) => [
          index > 0
            ? React.createElement('span', { key: `separator-${crumb.path}`, style: { opacity: 0.45 } }, '/')
            : null,
          React.createElement(
            'button',
            {
              key: crumb.path || 'root',
              type: 'button',
              onClick: () => onNavigate(crumb.path),
              style: {
                border: 0,
                padding: '3px 4px',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }
            },
            crumb.label
          )
        ].filter(Boolean))
      )
    }

    function EntryActionButton({ label, icon, onClick, disabled }) {
      return React.createElement('button', {
        type: 'button',
        title: label,
        'aria-label': label,
        onClick,
        disabled,
        style: {
          width: '28px',
          height: '28px',
          padding: 0,
          border: '1px solid transparent',
          borderRadius: '7px',
          background: 'transparent',
          color: 'var(--dsw-alias-label-secondary)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : 0.8
        }
      }, icon)
    }

    function EntryList({ listing, selectedPath, onOpen, onRename, onDelete, busy }) {
      if (listing === null) return null
      if (listing.entries.length === 0) {
        return React.createElement('div', { style: emptyStyle() }, messages.empty)
      }
      return React.createElement(
        'div',
        { role: 'list', style: { minHeight: 0, overflow: 'auto' } },
        listing.entries.map((entry) => {
          const selected = selectedPath === entry.path
          const icon = entry.type === 'directory' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄'
          return React.createElement(
            'div',
            {
              key: entry.path,
              role: 'listitem',
              style: {
                width: '100%',
                minHeight: '40px',
                borderBottom: '1px solid var(--dsw-alias-border-l2)',
                background: selected ? 'var(--dsw-alias-bg-hover)' : 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                display: 'flex',
                alignItems: 'center',
                paddingRight: '5px'
              }
            },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => onOpen(entry),
                title: entry.type === 'symlink' ? messages.symlink : entry.name,
                style: {
                  flex: 1,
                  minWidth: 0,
                  minHeight: '39px',
                  padding: '7px 5px 7px 10px',
                  border: 0,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(0, 1fr) auto',
                  alignItems: 'center',
                  gap: '7px',
                  textAlign: 'left'
                }
              },
              React.createElement('span', { 'aria-hidden': 'true' }, icon),
              React.createElement('span', {
                style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
              }, entry.name),
              entry.type === 'file'
                ? React.createElement('span', { style: { fontSize: '11px', opacity: 0.55 } }, formatBytes(entry.size))
                : null
            ),
            entry.type !== 'symlink'
              ? React.createElement(EntryActionButton, {
                  label: messages.rename,
                  icon: '✎',
                  disabled: busy,
                  onClick: () => onRename(entry)
                })
              : null,
            entry.type !== 'symlink'
              ? React.createElement(EntryActionButton, {
                  label: messages.delete,
                  icon: '×',
                  disabled: busy,
                  onClick: () => onDelete(entry)
                })
              : null
          )
        })
      )
    }

    function FilePreview({ preview, loading, error, draft, onDraftChange, onSave, onCancel, saving, saveError }) {
      if (loading) return React.createElement('div', { style: emptyStyle() }, messages.loading)
      if (error) return React.createElement('div', { style: { ...emptyStyle(), color: '#dc2626' } }, error)
      if (preview === null) return React.createElement('div', { style: emptyStyle() }, messages.select)

      const metadata = `${messages.size}: ${formatBytes(preview.size)} · ${messages.modified}: ${new Date(preview.mtimeMs).toLocaleString()}`
      const editable = !preview.binary && !preview.truncated
      const dirty = editable && draft !== preview.content
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'div',
          {
            style: {
              flex: '0 0 auto',
              padding: '9px 12px',
              borderBottom: '1px solid var(--dsw-alias-border-l2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }
          },
          React.createElement(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            React.createElement('strong', {
              style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            }, `${dirty ? '● ' : ''}${preview.name}`),
            React.createElement('span', { style: { fontSize: '11px', opacity: 0.58 } }, metadata)
          ),
          editable
            ? React.createElement(ToolbarButton, {
                onClick: onCancel,
                disabled: !dirty || saving,
                title: messages.cancel
              }, messages.cancel)
            : null,
          editable
            ? React.createElement(ToolbarButton, {
                onClick: onSave,
                disabled: !dirty || saving,
                title: messages.save
              }, saving ? messages.saving : messages.save)
            : null
        ),
        saveError
          ? React.createElement('div', {
              role: 'alert',
              style: { flex: '0 0 auto', padding: '7px 12px', color: '#dc2626', fontSize: '12px' }
            }, saveError)
          : null,
        preview.binary
          ? React.createElement('div', { style: emptyStyle() }, messages.binary)
          : preview.truncated
            ? React.createElement(
                'pre',
                {
                  style: {
                    flex: 1,
                    minHeight: 0,
                    margin: 0,
                    padding: '12px',
                    overflow: 'auto',
                    background: 'var(--dsw-alias-bg-base)',
                    color: 'var(--dsw-alias-label-primary)',
                    fontFamily: "SFMono-Regular,Consolas,'Liberation Mono',monospace",
                    fontSize: '12px',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere'
                  }
                },
                preview.content,
                React.createElement('div', {
                  style: { marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed currentColor', opacity: 0.65 }
                }, `[${messages.truncated}]`)
              )
            : React.createElement('textarea', {
                value: draft,
                onChange: (event) => onDraftChange(event.target.value),
                spellCheck: false,
                'aria-label': preview.name,
                style: {
                  boxSizing: 'border-box',
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  resize: 'none',
                  border: 0,
                  outline: 0,
                  padding: '12px',
                  overflow: 'auto',
                  background: 'var(--dsw-alias-bg-base)',
                  color: 'var(--dsw-alias-label-primary)',
                  fontFamily: "SFMono-Regular,Consolas,'Liberation Mono',monospace",
                  fontSize: '12px',
                  lineHeight: 1.55,
                  whiteSpace: 'pre',
                  tabSize: 2
                }
              })
      )
    }

    function emptyStyle() {
      return {
        flex: 1,
        minHeight: '90px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        color: 'var(--dsw-alias-label-secondary)',
        textAlign: 'center'
      }
    }

    function WorkspaceOverlay() {
      const { opened } = useOverlayState()
      const [currentPath, setCurrentPath] = React.useState('')
      const [listing, setListing] = React.useState(null)
      const [listError, setListError] = React.useState(null)
      const [listLoading, setListLoading] = React.useState(false)
      const [preview, setPreview] = React.useState(null)
      const [previewError, setPreviewError] = React.useState(null)
      const [previewLoading, setPreviewLoading] = React.useState(false)
      const [selectedPath, setSelectedPath] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [saveError, setSaveError] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [mutationBusy, setMutationBusy] = React.useState(false)
      const [refreshRevision, setRefreshRevision] = React.useState(0)
      const [compact, setCompact] = React.useState(() => window.innerWidth < 760)
      const dirty = preview !== null && !preview.binary && !preview.truncated && draft !== preview.content

      React.useEffect(() => {
        const resize = () => setCompact(window.innerWidth < 760)
        window.addEventListener('resize', resize)
        return () => window.removeEventListener('resize', resize)
      }, [])

      React.useEffect(() => {
        if (!opened) return undefined
        const controller = new AbortController()
        setListLoading(true)
        setListError(null)
        fetchJson(`/workspace-browser/list?path=${encodeURIComponent(currentPath)}`, { signal: controller.signal })
          .then((value) => setListing(value))
          .catch((error) => {
            if (error.name !== 'AbortError') setListError(error.message)
          })
          .finally(() => {
            if (!controller.signal.aborted) setListLoading(false)
          })
        return () => controller.abort()
      }, [opened, currentPath, refreshRevision])

      React.useEffect(() => {
        if (!opened) return undefined
        const handleKeyDown = (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            if (dirty && !saving) saveFile()
          }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
      }, [opened, dirty, saving, draft, preview])

      function clearPreview() {
        setSelectedPath(null)
        setPreview(null)
        setDraft('')
        setPreviewError(null)
        setSaveError(null)
      }

      function navigate(path) {
        if (!confirmDiscard(dirty)) return false
        setCurrentPath(path)
        clearPreview()
        return true
      }

      async function loadPreview(path) {
        setSelectedPath(path)
        setPreview(null)
        setDraft('')
        setPreviewError(null)
        setSaveError(null)
        setPreviewLoading(true)
        try {
          const value = await fetchJson(`/workspace-browser/file?path=${encodeURIComponent(path)}`)
          setPreview(value)
          setDraft(value.content ?? '')
        } catch (error) {
          setPreviewError(error.message)
        } finally {
          setPreviewLoading(false)
        }
      }

      async function openEntry(entry) {
        if (entry.type === 'directory') {
          navigate(entry.path)
          return
        }
        if (entry.path !== selectedPath && !confirmDiscard(dirty)) return
        await loadPreview(entry.path)
      }

      async function createEntry(type) {
        const promptText = type === 'directory' ? messages.createDirectoryPrompt : messages.createFilePrompt
        const input = window.prompt(promptText)
        if (input === null) return
        const name = input.trim()
        if (!validName(name)) {
          window.alert(messages.invalidName)
          return
        }
        if (type === 'file' && !confirmDiscard(dirty)) return
        setMutationBusy(true)
        try {
          const result = await mutateJson('/workspace-browser/entry', 'POST', {
            path: childPath(currentPath, name),
            type,
            content: type === 'file' ? '' : undefined
          })
          setRefreshRevision((value) => value + 1)
          if (type === 'file') await loadPreview(result.path)
        } catch (error) {
          window.alert(error.message)
        } finally {
          setMutationBusy(false)
        }
      }

      async function renameEntry(entry) {
        if (entry.path === selectedPath && !confirmDiscard(dirty)) return
        const input = window.prompt(messages.renamePrompt, entry.name)
        if (input === null) return
        const name = input.trim()
        if (!validName(name)) {
          window.alert(messages.invalidName)
          return
        }
        const destinationPath = childPath(currentPath, name)
        if (destinationPath === entry.path) return
        setMutationBusy(true)
        try {
          const result = await mutateJson('/workspace-browser/entry', 'PATCH', {
            path: entry.path,
            destinationPath
          })
          setRefreshRevision((value) => value + 1)
          if (entry.path === selectedPath) await loadPreview(result.path)
        } catch (error) {
          window.alert(error.message)
        } finally {
          setMutationBusy(false)
        }
      }

      async function deleteEntry(entry) {
        const template = entry.type === 'directory'
          ? messages.deleteDirectoryConfirm
          : messages.deleteFileConfirm
        if (!window.confirm(template.replace('{name}', entry.name))) return
        setMutationBusy(true)
        try {
          await mutateJson('/workspace-browser/entry', 'DELETE', {
            path: entry.path,
            recursive: entry.type === 'directory'
          })
          if (entry.path === selectedPath) clearPreview()
          setRefreshRevision((value) => value + 1)
        } catch (error) {
          window.alert(error.message)
        } finally {
          setMutationBusy(false)
        }
      }

      async function saveFile() {
        if (!preview || preview.binary || preview.truncated || !dirty || saving) return
        setSaving(true)
        setSaveError(null)
        try {
          const result = await mutateJson('/workspace-browser/file', 'PUT', {
            path: preview.path,
            content: draft,
            expectedMtimeMs: preview.mtimeMs
          })
          setPreview({ ...preview, ...result, content: draft, binary: false, truncated: false })
          setRefreshRevision((value) => value + 1)
        } catch (error) {
          setSaveError(error.message)
        } finally {
          setSaving(false)
        }
      }

      function refresh() {
        setRefreshRevision((value) => value + 1)
      }

      function close() {
        if (!confirmDiscard(dirty)) return
        clearPreview()
        updateOverlayState({ opened: false })
      }

      if (!opened) return null

      return React.createElement(
        'section',
        {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': messages.workspace,
          style: {
            position: 'absolute',
            inset: '12px',
            zIndex: 110,
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: '14px',
            background: 'var(--dsw-alias-bg-base)',
            boxShadow: '0 18px 60px rgba(0,0,0,.35)'
          }
        },
        React.createElement(
          'header',
          {
            style: {
              minHeight: '48px',
              flex: '0 0 auto',
              padding: '6px 10px 6px 14px',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              borderBottom: '1px solid var(--dsw-alias-border-l2)'
            }
          },
          React.createElement('strong', { style: { whiteSpace: 'nowrap' } }, messages.workspace),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement(Breadcrumbs, { currentPath, onNavigate: navigate })
          ),
          React.createElement(ToolbarButton, {
            onClick: () => createEntry('file'),
            disabled: mutationBusy,
            title: messages.createFile
          }, `＋ ${messages.createFile}`),
          React.createElement(ToolbarButton, {
            onClick: () => createEntry('directory'),
            disabled: mutationBusy,
            title: messages.createDirectory
          }, `＋ ${messages.createDirectory}`),
          React.createElement(ToolbarButton, {
            onClick: refresh,
            disabled: listLoading || mutationBusy,
            title: messages.refresh
          }, messages.refresh),
          React.createElement(ToolbarButton, {
            onClick: close,
            title: messages.close
          }, messages.close)
        ),
        React.createElement(
          'div',
          {
            style: {
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: compact ? '1fr' : 'minmax(230px, 34%) minmax(0, 1fr)',
              gridTemplateRows: compact ? 'minmax(180px, 42%) minmax(0, 1fr)' : '1fr'
            }
          },
          React.createElement(
            'aside',
            {
              style: {
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRight: compact ? 0 : '1px solid var(--dsw-alias-border-l2)',
                borderBottom: compact ? '1px solid var(--dsw-alias-border-l2)' : 0
              }
            },
            currentPath
              ? React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => navigate(parentPath(currentPath)),
                    style: {
                      flex: '0 0 38px',
                      padding: '0 12px',
                      border: 0,
                      borderBottom: '1px solid var(--dsw-alias-border-l2)',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }
                  },
                  '↩  ..'
                )
              : null,
            listLoading
              ? React.createElement('div', { style: emptyStyle() }, messages.loading)
              : listError
                ? React.createElement('div', { style: { ...emptyStyle(), color: '#dc2626' } }, listError)
                : React.createElement(EntryList, {
                    listing,
                    selectedPath,
                    onOpen: openEntry,
                    onRename: renameEntry,
                    onDelete: deleteEntry,
                    busy: mutationBusy
                  })
          ),
          React.createElement(
            'main',
            { style: { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            React.createElement(FilePreview, {
              preview,
              loading: previewLoading,
              error: previewError,
              draft,
              onDraftChange: (value) => {
                setDraft(value)
                setSaveError(null)
              },
              onSave: saveFile,
              onCancel: () => {
                setDraft(preview?.content ?? '')
                setSaveError(null)
              },
              saving,
              saveError
            })
          )
        )
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'workspace-browser',
        order: 40,
        label: messages.files
      }, WorkspaceButton))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'workspace-browser-overlay',
        order: 40,
        label: messages.workspace
      }, WorkspaceOverlay))
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  }
})
