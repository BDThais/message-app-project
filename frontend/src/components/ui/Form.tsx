import type { FormHTMLAttributes } from 'react';

export function Form(formProps: Omit<FormHTMLAttributes<HTMLFormElement>, 'className'>) {
  return <form className="grid gap-4" {...formProps} />;
}
