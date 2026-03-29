import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { TiptapEditorDirective } from 'ngx-tiptap';

@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  imports: [TiptapEditorDirective],
  template: `
    <div class="md-toolbar">
      <button type="button" title="Bold" [class.active]="editor?.isActive('bold')" (click)="cmd('bold')"><strong>B</strong></button>
      <button type="button" title="Italic" [class.active]="editor?.isActive('italic')" (click)="cmd('italic')"><em>I</em></button>
      <button type="button" title="Heading" [class.active]="editor?.isActive('heading')" (click)="cmd('heading')">H</button>
      <span class="md-sep"></span>
      <button type="button" title="Bullet List" [class.active]="editor?.isActive('bulletList')" (click)="cmd('bulletList')">&#8226;</button>
      <button type="button" title="Ordered List" [class.active]="editor?.isActive('orderedList')" (click)="cmd('orderedList')">1.</button>
    </div>
    <div tiptap [editor]="editor!" class="md-content"></div>
  `,
  styles: [`
    :host { display: block; }
    .md-toolbar {
      display: flex;
      gap: 2px;
      padding: 4px;
      border: 1px solid rgba(128,128,128,0.2);
      border-bottom: none;
      border-radius: 4px 4px 0 0;
    }
    .md-toolbar button {
      padding: 3px 8px;
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0.5;
      cursor: pointer;
      font-size: 0.85rem;
      border-radius: 3px;
    }
    .md-toolbar button:hover { opacity: 0.8; }
    .md-toolbar button.active { opacity: 1; background: rgba(128,128,128,0.15); }
    .md-sep { width: 1px; margin: 2px 4px; background: rgba(128,128,128,0.2); }
    .md-content {
      border: 1px solid rgba(128,128,128,0.2);
      border-radius: 0 0 4px 4px;
      min-height: 100px;
      padding: 0.5rem;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    :host ::ng-deep .tiptap { outline: none; min-height: 80px; }
    :host ::ng-deep .tiptap p { margin: 0 0 0.4rem; }
    :host ::ng-deep .tiptap h3 { font-size: 1rem; margin: 0 0 0.3rem; }
    :host ::ng-deep .tiptap ul, :host ::ng-deep .tiptap ol { padding-left: 1.2rem; margin: 0 0 0.4rem; }
    :host ::ng-deep .tiptap strong { font-weight: 600; }
    :host ::ng-deep .tiptap em { font-style: italic; }
  `],
})
export class MarkdownEditorComponent implements OnInit, OnDestroy {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  editor?: Editor;

  ngOnInit(): void {
    this.editor = new Editor({
      extensions: [
        StarterKit,
        Markdown,
      ],
      content: this.value,
      onUpdate: ({ editor }) => {
        const md = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
        this.valueChange.emit(md);
      },
    });
  }

  cmd(type: string): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    switch (type) {
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'heading': chain.toggleHeading({ level: 3 }).run(); break;
      case 'bulletList': chain.toggleBulletList().run(); break;
      case 'orderedList': chain.toggleOrderedList().run(); break;
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }
}
