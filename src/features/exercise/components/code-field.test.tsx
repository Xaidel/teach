// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const highlightMock =
  vi.fn<(code: string, language: string, theme: string) => string | undefined>()

vi.mock('../use-code-highlight', () => ({
  useCodeHighlight: (code: string, language: string, theme: string) =>
    highlightMock(code, language, theme),
}))

import { CodeField } from './code-field'

describe('CodeField', () => {
  afterEach(() => {
    highlightMock.mockReset()
  })

  it('renders an editable textarea backed by the given value', async () => {
    highlightMock.mockReturnValue(undefined)
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <CodeField
        id="code"
        language="rust"
        onChange={onChange}
        value="fn main() {}"
      />,
    )

    const field = screen.getByDisplayValue('fn main() {}')
    expect(field).toHaveAttribute('id', 'code')
    expect(field).not.toBeDisabled()

    await user.type(field, 'x')
    expect(onChange).toHaveBeenCalled()
  })

  it('renders the highlighted overlay once shiki has produced HTML', () => {
    highlightMock.mockReturnValue('<pre><code>fn main() {}</code></pre>')

    const { container } = render(
      <CodeField
        id="code"
        language="rust"
        onChange={vi.fn()}
        value="fn main() {}"
      />,
    )

    const overlay = container.querySelector('[aria-hidden="true"]')
    expect(overlay).not.toBeNull()
    expect(overlay).not.toHaveClass('invisible')
    expect(overlay?.innerHTML).toContain('fn main() {}')
    // The overlay sits behind the textarea in the DOM — the textarea's own
    // background has to go transparent too, or it paints over (hides) the
    // highlighted layer regardless of the text color.
    expect(screen.getByDisplayValue('fn main() {}')).toHaveClass(
      'bg-transparent',
      'text-transparent',
    )
  })

  it('keeps the plain textarea legible while no highlight is available', () => {
    highlightMock.mockReturnValue(undefined)

    const { container } = render(
      <CodeField
        id="code"
        language="rust"
        onChange={vi.fn()}
        value="fn main() {}"
      />,
    )

    const overlay = container.querySelector('[aria-hidden="true"]')
    expect(overlay).toHaveClass('invisible')
    expect(screen.getByDisplayValue('fn main() {}')).toHaveClass(
      'bg-background',
      'text-foreground',
    )
  })

  it('disables the textarea when disabled', () => {
    highlightMock.mockReturnValue(undefined)

    render(
      <CodeField
        disabled
        id="code"
        language="go"
        onChange={vi.fn()}
        value="package main"
      />,
    )

    expect(screen.getByDisplayValue('package main')).toBeDisabled()
  })

  it('omits the language dropdown when no languagePicker is given (the exercise field)', () => {
    highlightMock.mockReturnValue(undefined)

    render(<CodeField id="code" language="rust" onChange={vi.fn()} value="" />)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows the predicted language under a "Detected Language" label and re-highlights when the learner picks another one', async () => {
    highlightMock.mockReturnValue(undefined)
    const user = userEvent.setup()
    const onLanguageChange = vi.fn()

    render(
      <CodeField
        id="code"
        language="go"
        languagePicker={{ onLanguageChange }}
        onChange={vi.fn()}
        value="package main"
      />,
    )

    expect(screen.getByLabelText('Detected Language')).toHaveValue('go')

    await user.selectOptions(
      screen.getByLabelText('Detected Language'),
      'python',
    )

    expect(onLanguageChange).toHaveBeenCalledWith('python')
  })

  describe('vim mode', () => {
    /** `CodeField` mutates the textarea's DOM value directly, then reports
     * it via `onChange` — exactly how a real caller's own state update
     * would happen. A bare `vi.fn()` `onChange` never feeds that back into
     * a `value` prop, and React's controlled-input reconciliation then
     * resets the DOM back to the stale prop on the next render (the same
     * "typing appears to do nothing" trap an uncontrolled `onChange`
     * always hits). This harness closes that loop with real state, the
     * way `ExerciseEditor` actually uses the field. */
    function VimHarness({
      initialValue,
    }: {
      initialValue: string
    }): React.JSX.Element {
      const [value, setValue] = useState(initialValue)
      return (
        <CodeField
          id="code"
          language="rust"
          onChange={setValue}
          value={value}
        />
      )
    }

    /** Renders the harness, mocks out highlighting, and switches vim mode
     * on — every test below needs that same setup before it can drive the
     * field. */
    async function renderInVimMode(initialValue: string): Promise<{
      field: HTMLTextAreaElement
      user: ReturnType<typeof userEvent.setup>
    }> {
      highlightMock.mockReturnValue(undefined)
      const user = userEvent.setup()
      render(<VimHarness initialValue={initialValue} />)
      await user.click(screen.getByRole('switch', { name: 'Vim mode' }))
      const field = screen.getByRole<HTMLTextAreaElement>('textbox')
      return { field, user }
    }

    it('is off by default, leaving the textarea to type normally', async () => {
      highlightMock.mockReturnValue(undefined)
      const user = userEvent.setup()
      render(<VimHarness initialValue="" />)

      expect(screen.getByRole('switch', { name: 'Vim mode' })).toHaveAttribute(
        'aria-checked',
        'false',
      )

      const field = screen.getByRole<HTMLTextAreaElement>('textbox')
      await user.click(field)
      await user.keyboard('hi')
      // Off by default, so letters that double as vim motions ("h", "i")
      // still land as ordinary typed characters.
      expect(field.value).toBe('hi')
    })

    it('starts in normal mode once toggled on, and blocks unmapped keys', async () => {
      const { field, user } = await renderInVimMode('abc')

      expect(screen.getByRole('switch', { name: 'Vim mode' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()

      field.focus()
      await user.keyboard('q') // not a recognized command
      expect(field.value).toBe('abc')
    })

    it('dd deletes the current line into the register; p pastes it back below', async () => {
      const { field, user } = await renderInVimMode('one\ntwo\nthree')
      field.focus()
      field.setSelectionRange(0, 0) // on "one"

      await user.keyboard('dd')
      expect(field.value).toBe('two\nthree')

      // dd left the caret at the start of "two", now the current line.
      await user.keyboard('p')
      expect(field.value).toBe('two\none\nthree')
    })

    it('x deletes the character under the caret; u/Ctrl-r undo and redo it', async () => {
      const { field, user } = await renderInVimMode('abc')
      field.focus()
      field.setSelectionRange(0, 0)

      await user.keyboard('x')
      expect(field.value).toBe('bc')

      await user.keyboard('u')
      expect(field.value).toBe('abc')

      await user.keyboard('{Control>}r{/Control}')
      expect(field.value).toBe('bc')
    })

    it('cw changes to the end of the word, keeping trailing space, and drops into insert', async () => {
      const { field, user } = await renderInVimMode('foo bar')
      field.focus()
      field.setSelectionRange(0, 0)

      await user.keyboard('cw')
      expect(screen.getByText('-- INSERT --')).toBeInTheDocument()
      await user.keyboard('baz')
      expect(field.value).toBe('baz bar')
    })

    it('ciw changes the word under the caret without touching its neighbors', async () => {
      const { field, user } = await renderInVimMode('let username = "Karl";')
      field.focus()
      field.setSelectionRange(5, 5) // inside "username"

      await user.keyboard('ciw')
      expect(field.value).toBe('let  = "Karl";')
      expect(screen.getByText('-- INSERT --')).toBeInTheDocument()
    })

    it('o opens a new line below and types into it', async () => {
      const { field, user } = await renderInVimMode('one\ntwo')
      field.focus()
      field.setSelectionRange(0, 0)

      await user.keyboard('o')
      expect(field.value).toBe('one\n\ntwo')
      expect(screen.getByText('-- INSERT --')).toBeInTheDocument()
      await user.keyboard('mid')
      expect(field.value).toBe('one\nmid\ntwo')
    })

    it('A appends at the end of the line', async () => {
      const { field, user } = await renderInVimMode('let x = 1;')
      field.focus()
      field.setSelectionRange(4, 4) // on "x"

      await user.keyboard('A')
      expect(screen.getByText('-- INSERT --')).toBeInTheDocument()
      await user.keyboard('!!')
      expect(field.value).toBe('let x = 1;!!')
    })

    it('gg/G jump to the first/last line', async () => {
      const { field, user } = await renderInVimMode('one\ntwo\nthree')
      field.focus()
      field.setSelectionRange(9, 9) // on "three"

      await user.keyboard('gg')
      expect(field.selectionStart).toBe(0)

      await user.keyboard('G')
      expect(field.selectionStart).toBe(8) // start of "three"
    })

    it('v selects charwise and d deletes the selection', async () => {
      const { field, user } = await renderInVimMode('hello world')
      field.focus()
      field.setSelectionRange(0, 0)

      await user.keyboard('vwd') // select "hello w", then delete it
      expect(field.value).toBe('orld')
      expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()
    })

    it('V then G extends the linewise selection to the last line', async () => {
      const { field, user } = await renderInVimMode('one\ntwo\nthree\nfour')
      field.focus()
      field.setSelectionRange(4, 4) // on "two"

      await user.keyboard('VGd') // select "two".."four" linewise, then delete
      expect(field.value).toBe('one')
    })

    it('V then gg extends the linewise selection back to the first line', async () => {
      const { field, user } = await renderInVimMode('one\ntwo\nthree\nfour')
      field.focus()
      field.setSelectionRange(4, 4) // on "two"

      await user.keyboard('Vggd') // select "one".."two" linewise, then delete
      expect(field.value).toBe('three\nfour')
    })

    it('/ searches forward and n repeats, wrapping around at the end', async () => {
      const { field, user } = await renderInVimMode('foo bar foo baz')
      field.focus()
      field.setSelectionRange(0, 0)

      await user.keyboard('/foo{Enter}')
      expect(field.selectionStart).toBe(8) // the second "foo"

      await user.keyboard('n')
      expect(field.selectionStart).toBe(0) // wraps back to the first
    })

    it(': jumps to a 1-indexed line number', async () => {
      const { field, user } = await renderInVimMode('one\ntwo\nthree')
      field.focus()
      field.setSelectionRange(0, 0)

      await user.keyboard(':3{Enter}')
      expect(field.selectionStart).toBe(8) // start of "three"
    })
  })
})
