/* Stateless fixed-ABI calls. No heap objects, retained FDs, callbacks or finalizers.
 * C, not an incorrectly declared fixed-arity FFI call, supplies fcntl's varargs. */
#define _GNU_SOURCE
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <sys/socket.h>

static int failure(void) { return -100 - errno; }
static int io_result(long n) {
  if (n >= 0) return (int)n;
  if (errno == EAGAIN || errno == EWOULDBLOCK) return -1;
  if (errno == EINTR) return -2;
  return failure();
}
int scout_channel_pair(int duplex, int minimum, int *out) {
  int raw[2] = {-1, -1}, parent = -1, source = -1, error;
  /* Bun ignores SIGPIPE on the audited host. Refuse a changed disposition,
   * rather than change process-global signal policy or risk process death.
   * The trusted host must not change it while a channel is active. */
  struct sigaction action;
  if (sigaction(SIGPIPE, 0, &action) != 0) return failure();
  if (action.sa_handler != SIG_IGN) return -3;
#ifdef __linux__
  if ((duplex ? socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, raw)
              : pipe2(raw, O_CLOEXEC)) != 0) return failure();
#else
  if ((duplex ? socketpair(AF_UNIX, SOCK_STREAM, 0, raw) : pipe(raw)) != 0) return failure();
  if (fcntl(raw[0], F_SETFD, FD_CLOEXEC) < 0 || fcntl(raw[1], F_SETFD, FD_CLOEXEC) < 0) goto failed;
#endif
  if (duplex) {
    /* Bound kernel-side send buffering too; OS-specific rounding is allowed. */
    int size = 8192;
    if (setsockopt(raw[1], SOL_SOCKET, SO_SNDBUF, &size, sizeof(size)) < 0) goto failed;
  }
  int status = fcntl(raw[1], F_GETFL);
  if (status < 0 || fcntl(raw[1], F_SETFL, status | O_NONBLOCK) < 0) goto failed;
  source = fcntl(raw[0], F_DUPFD_CLOEXEC, minimum);
  if (source < 0) goto failed;
  parent = fcntl(raw[1], F_DUPFD_CLOEXEC, minimum);
  if (parent < 0) goto failed;
  close(raw[0]); close(raw[1]);
  out[0] = parent; out[1] = source;
  return 0;
failed:
  error = failure();
  if (parent >= 0) close(parent);
  if (source >= 0) close(source);
  close(raw[0]); close(raw[1]);
  return error;
}
int scout_channel_flags(int fd) { return fcntl(fd, F_GETFD); }
int scout_channel_nonblocking(int fd) {
  int flags = fcntl(fd, F_GETFL);
  return flags < 0 ? failure() : !!(flags & O_NONBLOCK);
}
int scout_channel_read(int fd, void *bytes, int length) { return io_result(read(fd, bytes, length)); }
int scout_channel_write(int fd, const void *bytes, int length) { return io_result(write(fd, bytes, length)); }
int scout_channel_close(int fd) { return close(fd) == 0 ? 0 : failure(); }
