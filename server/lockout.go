package server

import (
	"math"
	"sync"
	"time"
)

// LockoutTimer implements a simple rate limiter to prevent brute force attacks
type LockoutTimer struct {
	mutex       sync.Mutex
	bucketTime  int64
	bucketCount int
	bucketSize  int64 // duration in milliseconds
	limit       int
	disabled    bool
}

// NewLockoutTimer creates a new lockout timer
// countPeriodMs: time window in milliseconds
// limit: maximum attempts allowed in the time window
func NewLockoutTimer(countPeriodMs int, limit int) *LockoutTimer {
	disabled := math.IsNaN(float64(countPeriodMs)) || math.IsNaN(float64(limit)) ||
		countPeriodMs < 1 || limit < 1

	return &LockoutTimer{
		bucketSize: int64(countPeriodMs),
		limit:      limit,
		disabled:   disabled,
	}
}

// updateBucketTime updates the current bucket time and resets count if needed
func (lt *LockoutTimer) updateBucketTime() {
	currentBucketTime := time.Now().UnixMilli() / lt.bucketSize
	if lt.bucketTime == currentBucketTime {
		return
	}
	// the bucket is too old - empty it
	lt.bucketTime = currentBucketTime
	lt.bucketCount = 0
}

// IsLocked checks if the timer is currently locked due to too many attempts
func (lt *LockoutTimer) IsLocked() bool {
	if lt.disabled {
		return false
	}

	lt.mutex.Lock()
	defer lt.mutex.Unlock()

	lt.updateBucketTime()
	return lt.bucketCount >= lt.limit
}

// AddCount increments the attempt counter
// IsLocked() should be called first to keep bucketTime current
func (lt *LockoutTimer) AddCount() {
	if lt.disabled {
		return
	}

	lt.mutex.Lock()
	defer lt.mutex.Unlock()

	// updateBucketTime should have been called by IsLocked first
	lt.bucketCount++
}
