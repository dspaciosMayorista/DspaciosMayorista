"use client";

import {
	Toast,
	ToastClose,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from '@/components/sitio/ui/toast';
import { useToast } from '@/components/sitio/ui/use-toast';
import React from 'react';

export function Toaster() {
	const { toasts } = useToast();

	return (
		<ToastProvider>
			{toasts.map(({ id, title, description, action, dismiss, duration, variant, className }) => {
				return (
					<Toast key={id} variant={variant} className={className}>
						<div className="grid gap-1">
							{title && <ToastTitle>{title}</ToastTitle>}
							{description && (
								<ToastDescription>{description}</ToastDescription>
							)}
						</div>
						{action}
						<ToastClose onClick={() => dismiss?.()} />
					</Toast>
				);
			})}
			<ToastViewport />
		</ToastProvider>
	);
}
