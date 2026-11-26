'use client';

import { WidgetRoot, defineWidget } from '@nerey/core';
import type { WidgetComponentProps } from '@nerey/core';
import { Button } from '@nerey/theme';
import type { ReactElement } from 'react';

import { offerContract } from './contract';
import type { OfferPayload } from './contract';

function OfferWidget(props: WidgetComponentProps<OfferPayload, Record<string, never>>): ReactElement {
  const { payload, readonly, status, onInteraction } = props;
  return (
    <WidgetRoot type="offer" version="1.0.0" slot="message" status={status} readonly={readonly}>
      <p>{payload.title}</p>
      <Button
        disabled={readonly}
        onClick={() => onInteraction('accept', { text: `I accept: ${payload.title}` })}
      >
        {readonly ? 'Offer closed' : payload.acceptLabel}
      </Button>
    </WidgetRoot>
  );
}

export const offerWidget = defineWidget<OfferPayload, Record<string, never>>({
  ...offerContract,
  component: OfferWidget,
});
