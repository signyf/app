import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the get started heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /get started/i }),
    ).toBeInTheDocument()
  })

  it('increments the counter when the button is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)

    const button = screen.getByRole('button', { name: /count is 0/i })
    expect(button).toBeInTheDocument()

    await user.click(button)
    expect(
      screen.getByRole('button', { name: /count is 1/i }),
    ).toBeInTheDocument()

    await user.click(button)
    expect(
      screen.getByRole('button', { name: /count is 2/i }),
    ).toBeInTheDocument()
  })
})
