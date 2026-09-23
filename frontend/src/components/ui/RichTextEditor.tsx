import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Bold, Italic, Underline as UnderlineIcon, List } from "lucide-react";
import { useEffect } from "react";

interface RichTextEditorProps {
  id?: string;
  /** Contenido HTML actual (whitelist: p, br, strong, em, u, ul, ol, li -- ver clinical-note-sanitizer.util.ts en el backend). */
  value: string;
  /** Se dispara en cada cambio con el HTML resultante, para encajar con el mismo patrón de useState local que ya usan ConsultationForm/ConsultationsPage. */
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Nombre accesible del área editable. Un <label htmlFor> normal no
   * etiqueta un <div contenteditable> (no es un elemento "labelable" según
   * el spec de HTML, a diferencia de <textarea>), así que FormField solo
   * aporta la etiqueta visual acá -- este prop es lo que le da nombre
   * accesible real (role="textbox" + aria-label) para lectores de pantalla
   * y para los tests (getByRole('textbox', { name })).
   */
  ariaLabel?: string;
}

// Issue #159: editor rich-text mínimo (negrita/cursiva/subrayado/lista) para
// las notas clínicas de sesión. Alcance deliberadamente acotado -- sin
// tablas, imágenes ni colores -- para calzar 1:1 con la whitelist que ya
// sanitiza el backend (clinical-note-sanitizer.util.ts). No usa
// react-hook-form: recibe value/onChange controlados como un input más, para
// integrarse sin migrar los dos formularios que hoy manejan estado con
// useState plano.
export default function RichTextEditor({
  id,
  value,
  onChange,
  placeholder,
  className = "",
  ariaLabel,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Fuera de alcance del issue: solo bold/italic/underline/listas/párrafos.
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      Underline,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "input-field min-h-[4.5rem] text-slate-800 [&_p]:m-0 [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal",
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        ...(id ? { id } : {}),
      },
    },
    onUpdate: ({ editor }) => {
      // Tiptap devuelve "<p></p>" para un editor "vacío" -- se normaliza a
      // "" para no romper las validaciones existentes de required
      // (`!form.consultReason.trim()`) que esperaban un string vacío real.
      const html = editor.isEmpty ? "" : editor.getHTML();
      onChange(html);
    },
  });

  // El valor puede cambiar desde afuera (ej. al abrir el modal de corrección
  // con los datos de la consulta, o al resetear el form tras guardar) sin
  // pasar por onUpdate -- hay que resincronizar el editor en esos casos.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value ?? "", false);
    }
  }, [value, editor]);

  if (!editor) return null;

  const isEmptyDoc = editor.isEmpty;

  return (
    <div className={className}>
      <div className="flex items-center gap-1 border border-slate-200 border-b-0 rounded-t-lg bg-slate-50 px-2 py-1">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="Negrita"
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="Cursiva"
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          label="Subrayado"
        >
          <UnderlineIcon size={14} />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Lista con viñetas"
        >
          <List size={14} />
        </ToolbarButton>
      </div>
      <div className="relative">
        {isEmptyDoc && placeholder && (
          <p className="absolute top-2 left-3 text-slate-400 pointer-events-none text-sm">
            {placeholder}
          </p>
        )}
        <EditorContent
          editor={editor}
          className="[&_.ProseMirror]:rounded-t-none [&_.ProseMirror]:rounded-b-lg [&_.ProseMirror]:outline-none"
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`p-1.5 rounded transition-colors ${
        active ? "bg-sage-100 text-sage-700" : "text-slate-500 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
