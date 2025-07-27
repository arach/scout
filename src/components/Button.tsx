import React from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  fullWidth?: boolean;
  iconOnly?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Button component using CSS modules for encapsulated styling
 * This is an example of how to migrate components to the new CSS architecture
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  loading = false,
  fullWidth = false,
  iconOnly = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const buttonClasses = [
    styles.button,
    styles[variant],
    styles[size],
    loading && styles.loading,
    fullWidth && styles.fullWidth,
    iconOnly && styles.iconOnly,
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={buttonClasses}
      disabled={disabled || loading}
      {...props}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      {!iconOnly && children}
    </button>
  );
};

// Usage example:
// <Button variant="primary" size="medium" icon={<SaveIcon />}>
//   Save Changes
// </Button>