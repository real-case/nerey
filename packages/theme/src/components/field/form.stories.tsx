import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from '../button/button';
import { Input } from '../input/input';
import { Stack } from '../stack/stack';
import { Textarea } from '../input/textarea';
import { Field } from './field';
import { Form } from './form';

const meta = {
  title: 'Forms/Form',
  component: Form,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onFormSubmit: fn() },
  render: (args) => (
    <Form {...args}>
      <Field.Root name="name">
        <Field.Label>Name on the booking</Field.Label>
        <Input required />
        <Field.Error match="valueMissing">Please enter the name on the booking.</Field.Error>
      </Field.Root>
      <Field.Root name="email">
        <Field.Label>Email</Field.Label>
        <Input type="email" required placeholder="you@example.com" />
        <Field.Error match="valueMissing">We need an email address to reply to.</Field.Error>
        <Field.Error match="typeMismatch">That does not look like an email address.</Field.Error>
      </Field.Root>
      <Field.Root name="message">
        <Field.Label>What happened?</Field.Label>
        <Textarea rows={3} />
        <Field.Description>The more detail, the faster we can look it up.</Field.Description>
      </Field.Root>
      <Button type="submit">Send</Button>
    </Form>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByRole('textbox', { name: 'Name on the booking' }), 'A Traveller');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'a@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));

    await expect(args.onFormSubmit).toHaveBeenCalledTimes(1);
    // The values arrive keyed by each field's `name`, which is also how `errors` comes back.
    await expect(args.onFormSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'A Traveller', email: 'a@example.com' }),
      expect.anything(),
    );
  },
};

/**
 * The behaviour this wrapper exists for.
 *
 * A failed submit moves focus to the first invalid field in document order. Without it a
 * keyboard or screen-reader user is told the form failed and left standing on the submit button,
 * with no way to find the problem short of tabbing through everything.
 */
export const FocusesTheFirstInvalidField: Story = {
  render: () => (
    <Form>
      <Field.Root name="name">
        <Field.Label>Name on the booking</Field.Label>
        <Input required />
        <Field.Error match="valueMissing">Please enter the name on the booking.</Field.Error>
      </Field.Root>
      <Field.Root name="email">
        <Field.Label>Email</Field.Label>
        <Input type="email" required />
        <Field.Error match="valueMissing">We need an email address to reply to.</Field.Error>
      </Field.Root>
      <Button type="submit">Send</Button>
    </Form>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));

    await expect(canvas.getByRole('textbox', { name: 'Name on the booking' })).toHaveFocus();
    await expect(canvas.getByText('Please enter the name on the booking.')).toBeVisible();
    await expect(canvas.getByText('We need an email address to reply to.')).toBeVisible();
  },
};

/**
 * `errors` is the seam for validation that happens somewhere else — a server, a rate limit, a
 * uniqueness check. It is keyed by each `Field.Root`'s `name`, which is what puts the message
 * under the right label without the form knowing anything about the rule that produced it.
 */
export const ServerErrors: Story = {
  render: function ServerErrorsStory() {
    const [errors, setErrors] = useState<Record<string, string | string[]>>({});

    return (
      <Form
        errors={errors}
        onFormSubmit={(values) => {
          // Deterministic on purpose: no network, no clock, no randomness (ADR 0031).
          setErrors(
            values.email === 'taken@example.com'
              ? { email: 'That address is already on another booking.' }
              : {},
          );
        }}
      >
        <Field.Root name="email">
          <Field.Label>Email</Field.Label>
          <Input type="email" defaultValue="taken@example.com" />
          <Field.Error />
        </Field.Root>
        <Button type="submit">Save</Button>
      </Form>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const email = canvas.getByRole('textbox', { name: 'Email' });

    await expect(canvas.queryByText('That address is already on another booking.')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await expect(canvas.getByText('That address is already on another booking.')).toBeVisible();
    await expect(email).toHaveAttribute('data-invalid');
  },
};

/** A whole form can be locked while a submit is in flight; every field reads it from the root. */
export const AllFieldsDisabled: Story = {
  render: () => (
    <Form>
      <Stack gap={6}>
        <Field.Root name="name" disabled>
          <Field.Label>Name on the booking</Field.Label>
          <Input defaultValue="A Traveller" />
        </Field.Root>
        <Field.Root name="email" disabled>
          <Field.Label>Email</Field.Label>
          <Input defaultValue="a@example.com" />
        </Field.Root>
        <Button type="submit" disabled>
          Sending…
        </Button>
      </Stack>
    </Form>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Name on the booking' })).toBeDisabled();
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  },
};

/** An empty form is still a form: the rhythm comes from the wrapper, not from field margins. */
export const Empty: Story = {
  render: () => (
    <Form aria-label="Empty form">
      <Field.Root name="reference">
        <Field.Label>Booking reference</Field.Label>
        <Input placeholder="e.g. NX-4821" />
      </Field.Root>
    </Form>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('form', { name: 'Empty form' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Booking reference' })).toHaveValue('');
  },
};
