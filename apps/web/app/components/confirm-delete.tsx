import { Button } from '@raisin/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@raisin/ui/dialog';
import { Input } from '@raisin/ui/input';
import { Label } from '@raisin/ui/label';
import { type ReactNode, useId, useState } from 'react';
import { Form, useNavigation } from 'react-router';

/**
 * A delete that asks first. The dialog names what will be lost, and when `confirmText` is set
 * the delete button stays disabled until that text is typed. Submits `intent=delete` to the
 * current route's action.
 */
export function ConfirmDelete({
  trigger,
  title,
  description,
  action,
  confirmText,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  /** The button label, naming the action: "Delete crawl", "Delete project". */
  action: string;
  confirmText?: string;
}) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const busy = useNavigation().state !== 'idle';
  const ready = !confirmText || typed.trim() === confirmText;
  return (
    <Dialog onOpenChange={() => setTyped('')}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <Form method="post" className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {confirmText && (
            <div className="grid gap-1.5">
              <Label htmlFor={id} className="font-normal">
                Type <span className="font-mono font-medium">{confirmText}</span> to confirm
              </Label>
              <Input
                id={id}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              name="intent"
              value="delete"
              variant="destructive"
              disabled={!ready || busy}
            >
              {busy ? 'Deleting…' : action}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
