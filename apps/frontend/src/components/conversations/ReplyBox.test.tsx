import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReplyBox } from './ReplyBox';

describe('ReplyBox', () => {
  it('renders textarea and send button', () => {
    render(<ReplyBox onSend={() => {}} isPending={false} error={null} />);
    expect(screen.getByPlaceholderText(/Escribir respuesta/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('send button is disabled when textarea is empty', () => {
    render(<ReplyBox onSend={() => {}} isPending={false} error={null} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('send button is disabled when pending', () => {
    render(<ReplyBox onSend={() => {}} isPending={true} error={null} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls onSend with message text and clears textarea', () => {
    const onSend = vi.fn();
    render(<ReplyBox onSend={onSend} isPending={false} error={null} />);
    const textarea = screen.getByPlaceholderText(/Escribir respuesta/);
    fireEvent.change(textarea, { target: { value: 'Hola' } });
    fireEvent.click(screen.getByRole('button'));
    expect(onSend).toHaveBeenCalledWith('Hola');
  });

  it('submits on Ctrl+Enter', () => {
    const onSend = vi.fn();
    render(<ReplyBox onSend={onSend} isPending={false} error={null} />);
    const textarea = screen.getByPlaceholderText(/Escribir respuesta/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('Test');
  });

  it('shows error message when error is set', () => {
    render(<ReplyBox onSend={() => {}} isPending={false} error="WhatsApp send failed" />);
    expect(screen.getByText(/WhatsApp send failed/)).toBeInTheDocument();
  });

  it('shows "Enviando..." when pending', () => {
    render(<ReplyBox onSend={() => {}} isPending={true} error={null} />);
    expect(screen.getByText(/Enviando/)).toBeInTheDocument();
  });
});
