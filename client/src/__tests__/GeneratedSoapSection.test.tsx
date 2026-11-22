/**
 * Generated SOAP sections must be therapist-editable before signing, and the
 * edited text must be what flows back into the note state (which Save, the
 * autosaved draft and the doc-check all read). QA sweep 2026-11-18: the
 * sections were read-only paragraphs while the doc-check copy claimed they
 * could be edited directly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import GeneratedSoapSection from '@/components/GeneratedSoapSection';

describe('GeneratedSoapSection', () => {
  it('renders the generated text read-only with an Edit control and no edited badge', () => {
    render(
      <GeneratedSoapSection
        sectionKey="objective"
        label="OBJECTIVE"
        labelClassName="text-green-600"
        value="Trampoline jumping, five sets of ten."
        edited={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId('text-objective')).toHaveTextContent('Trampoline jumping, five sets of ten.');
    expect(screen.getByTestId('button-edit-objective')).toBeInTheDocument();
    expect(screen.queryByTestId('textarea-edit-objective')).toBeNull();
    expect(screen.queryByTestId('badge-edited-objective')).toBeNull();
  });

  it('Edit → type → Save hands the edited text to onSave and leaves edit mode', () => {
    const onSave = vi.fn();
    render(
      <GeneratedSoapSection
        sectionKey="assessment"
        label="ASSESSMENT"
        labelClassName="text-purple-600"
        value="Model text."
        edited={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('button-edit-assessment'));
    const ta = screen.getByTestId('textarea-edit-assessment') as HTMLTextAreaElement;
    expect(ta.value).toBe('Model text.');
    fireEvent.change(ta, { target: { value: 'Therapist text: tolerated 5x10 jumps without pain.' } });
    fireEvent.click(screen.getByTestId('button-save-assessment'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('Therapist text: tolerated 5x10 jumps without pain.');
    expect(screen.queryByTestId('textarea-edit-assessment')).toBeNull();
  });

  it('Cancel discards the typed text and calls nothing', () => {
    const onSave = vi.fn();
    render(
      <GeneratedSoapSection
        sectionKey="plan"
        label="PLAN"
        labelClassName="text-orange-600"
        value="Continue plan."
        edited={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('button-edit-plan'));
    fireEvent.change(screen.getByTestId('textarea-edit-plan'), { target: { value: 'scratch' } });
    fireEvent.click(screen.getByTestId('button-cancel-plan'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('text-plan')).toHaveTextContent('Continue plan.');
  });

  it('shows the "Edited by therapist" badge once a section has been edited', () => {
    render(
      <GeneratedSoapSection
        sectionKey="subjective"
        label="SUBJECTIVE"
        labelClassName="text-blue-600"
        value="Edited."
        edited
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId('badge-edited-subjective')).toHaveTextContent('Edited by therapist');
  });

  it('wired like the page: the saved edit is the text the note state holds afterwards', () => {
    // Mirrors soap-notes.tsx: onSave writes into the note object that Save,
    // the autosaved draft and the doc-check serialize.
    function Harness() {
      const [note, setNote] = useState({ subjective: 'Parent reports good week.', objective: 'o' });
      const [edited, setEdited] = useState<Set<string>>(new Set());
      return (
        <>
          <GeneratedSoapSection
            sectionKey="subjective"
            label="SUBJECTIVE"
            labelClassName="text-blue-600"
            value={note.subjective}
            edited={edited.has('subjective')}
            onSave={(t) => {
              setNote((p) => ({ ...p, subjective: t }));
              setEdited((p) => new Set(p).add('subjective'));
            }}
          />
          <pre data-testid="payload">{JSON.stringify(note)}</pre>
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByTestId('button-edit-subjective'));
    fireEvent.change(screen.getByTestId('textarea-edit-subjective'), {
      target: { value: 'Parent reports two falls this week; no injury.' },
    });
    fireEvent.click(screen.getByTestId('button-save-subjective'));

    expect(JSON.parse(screen.getByTestId('payload').textContent!)).toEqual({
      subjective: 'Parent reports two falls this week; no injury.',
      objective: 'o',
    });
    expect(screen.getByTestId('text-subjective')).toHaveTextContent('Parent reports two falls this week; no injury.');
    expect(screen.getByTestId('badge-edited-subjective')).toBeInTheDocument();
  });
});
