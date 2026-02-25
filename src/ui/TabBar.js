import { getFiles, getActiveFileId, switchToFile, createFile, deleteFile, renameFile } from '../core/FileManager.js';

export function buildTabBar() {
  const container = document.getElementById('tab-bar');
  if (!container) return;
  container.innerHTML = '';

  const files = getFiles();
  const activeId = getActiveFileId();

  for (const file of files) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (file.id === activeId ? ' active' : '');
    tab.dataset.id = file.id;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = file.name;
    tab.appendChild(label);

    // Close button (hidden if only 1 file)
    if (files.length > 1) {
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '\u00D7';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        if (deleteFile(file.id)) {
          buildTabBar();
        }
      });
      tab.appendChild(close);
    }

    // Click to switch
    tab.addEventListener('click', () => {
      if (file.id !== activeId) {
        switchToFile(file.id);
        buildTabBar();
      }
    });

    // Double-click to rename
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(label, file);
    });

    container.appendChild(tab);
  }

  // "+" button
  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    createFile();
    buildTabBar();
  });
  container.appendChild(addBtn);
}

function startInlineRename(labelEl, file) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-rename-input';
  input.value = file.name;
  input.spellcheck = false;

  labelEl.style.display = 'none';
  labelEl.parentNode.insertBefore(input, labelEl);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim() || file.name;
    renameFile(file.id, newName);
    labelEl.textContent = newName;
    labelEl.style.display = '';
    if (input.parentNode) input.remove();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = file.name; input.blur(); }
  });
}
