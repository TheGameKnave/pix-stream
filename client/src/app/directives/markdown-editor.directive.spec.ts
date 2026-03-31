import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownEditorComponent } from './markdown-editor.directive';

describe('MarkdownEditorComponent', () => {
  let component: MarkdownEditorComponent;
  let fixture: ComponentFixture<MarkdownEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownEditorComponent);
    component = fixture.componentInstance;
    component.value = '**Hello** world';
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('initializes editor on init', () => {
    expect(component.editor).toBeTruthy();
  });

  it('renders toolbar buttons', () => {
    const buttons = fixture.nativeElement.querySelectorAll('.md-toolbar button');
    expect(buttons.length).toBe(6); // Bold, Italic, Heading, Bullet, Ordered, Link
  });

  it('toolbar buttons have title attributes', () => {
    const buttons = fixture.nativeElement.querySelectorAll('.md-toolbar button');
    const titles = Array.from(buttons).map((b: any) => b.title);
    expect(titles).toContain('Bold');
    expect(titles).toContain('Italic');
    expect(titles).toContain('Heading');
    expect(titles).toContain('Link');
  });

  it('cmd does nothing when editor is undefined', () => {
    component.editor = undefined;
    expect(() => component.cmd('bold')).not.toThrow();
  });

  it('cmd toggles bold', () => {
    expect(() => component.cmd('bold')).not.toThrow();
  });

  it('cmd toggles italic', () => {
    expect(() => component.cmd('italic')).not.toThrow();
  });

  it('cmd toggles heading', () => {
    expect(() => component.cmd('heading')).not.toThrow();
  });

  it('cmd toggles bulletList', () => {
    expect(() => component.cmd('bulletList')).not.toThrow();
  });

  it('cmd toggles orderedList', () => {
    expect(() => component.cmd('orderedList')).not.toThrow();
  });

  it('cmd link removes link when active', () => {
    // Set a link first, then toggle to remove
    component.editor!.chain().focus().selectAll().setLink({ href: 'https://example.com' }).run();
    expect(() => component.cmd('link')).not.toThrow();
  });

  it('destroys editor on ngOnDestroy', () => {
    component.ngOnDestroy();
    expect(component.editor?.isDestroyed).toBeTrue();
  });

  it('emits valueChange on editor update', (done) => {
    component.valueChange.subscribe((md: string) => {
      expect(typeof md).toBe('string');
      done();
    });
    // Trigger an update by inserting content
    component.editor!.commands.setContent('new content');
  });
});
