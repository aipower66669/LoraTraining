import { describe, expect, it } from 'vitest'
import { cellSizeForWidth, columnCountForWidth, nextIndexForArrow } from '@shared/image-grid-nav'

describe('image grid sizing', () => {
  it('picks column count from width', () => {
    expect(columnCountForWidth(112, 112, 8)).toBe(1)
    expect(columnCountForWidth(232, 112, 8)).toBe(2)
    expect(columnCountForWidth(560, 112, 8)).toBe(4)
    expect(columnCountForWidth(592, 112, 8)).toBe(5)
  })

  it('sizes square cells to fill the row', () => {
    expect(cellSizeForWidth(560, 5, 8)).toBe(105)
    expect(cellSizeForWidth(400, 3, 8)).toBe(128)
  })
})

describe('image grid arrow navigation', () => {
  // 12 items, 5 cols → rows: 5, 5, 2
  const n = 12
  const cols = 5

  it('moves right within row and wraps to next row', () => {
    expect(nextIndexForArrow(0, 'ArrowRight', cols, n)).toBe(1)
    expect(nextIndexForArrow(4, 'ArrowRight', cols, n)).toBe(5)
  })

  it('wraps right from last cell to first', () => {
    expect(nextIndexForArrow(11, 'ArrowRight', cols, n)).toBe(0)
  })

  it('wraps left from first cell to last', () => {
    expect(nextIndexForArrow(0, 'ArrowLeft', cols, n)).toBe(11)
  })

  it('moves left to previous row last cell', () => {
    expect(nextIndexForArrow(5, 'ArrowLeft', cols, n)).toBe(4)
  })

  it('wraps down from last row to top same column', () => {
    expect(nextIndexForArrow(10, 'ArrowDown', cols, n)).toBe(0)
    expect(nextIndexForArrow(11, 'ArrowDown', cols, n)).toBe(1)
  })

  it('wraps up from first row to bottom available column', () => {
    expect(nextIndexForArrow(0, 'ArrowUp', cols, n)).toBe(10)
    expect(nextIndexForArrow(2, 'ArrowUp', cols, n)).toBe(7)
    expect(nextIndexForArrow(1, 'ArrowUp', cols, n)).toBe(11)
  })

  it('moves down within column and wraps past short last row', () => {
    expect(nextIndexForArrow(1, 'ArrowDown', cols, n)).toBe(6)
    expect(nextIndexForArrow(6, 'ArrowDown', cols, n)).toBe(11)
    // col 2 has no cell on last row → wrap to top
    expect(nextIndexForArrow(7, 'ArrowDown', cols, n)).toBe(2)
  })
})
