#!/usr/bin/perl
# Minimal static file server for local preview (no external deps).
# Usage: perl tools/serve.pl [port] [docroot]
use strict;
use warnings;
use IO::Socket::INET;
use Cwd qw(abs_path);
use File::Spec;

$| = 1;
my $port    = shift // 8123;
my $docroot = abs_path(shift // '.');

my %MIME = (
  html => 'text/html; charset=utf-8',
  js   => 'text/javascript; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  json => 'application/json; charset=utf-8',
  webmanifest => 'application/manifest+json; charset=utf-8',
  svg  => 'image/svg+xml',
  png  => 'image/png',
  jpg  => 'image/jpeg',
  jpeg => 'image/jpeg',
  gif  => 'image/gif',
  ico  => 'image/x-icon',
  woff2 => 'font/woff2',
  txt  => 'text/plain; charset=utf-8',
);

my $server = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1',
  LocalPort => $port,
  Proto     => 'tcp',
  Listen    => 32,
  ReuseAddr => 1,
) or die "Cannot listen on port $port: $!\n";

print "serve.pl: http://localhost:$port/  (root: $docroot)\n";

while (my $client = $server->accept) {
  $client->autoflush(1);
  my $req = <$client>;
  unless (defined $req) { close $client; next; }
  # drain headers
  while (my $h = <$client>) { last if $h =~ /^\r?\n$/; }

  if ($req !~ m{^GET\s+(\S+)\s+HTTP}) {
    print $client "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
    close $client; next;
  }
  my $path = $1;
  $path =~ s/\?.*$//;
  $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
  $path = '/index.html' if $path eq '/';

  # prevent path traversal
  my @parts = grep { length && $_ ne '.' && $_ ne '..' } split m{/}, $path;
  my $file = File::Spec->catfile($docroot, @parts);
  my $abs  = abs_path($file) // '';

  if (!$abs || index($abs, $docroot) != 0 || !-f $abs) {
    # SPA fallback to index.html for unknown non-asset routes
    if ($path !~ /\.[a-z0-9]+$/i) {
      $abs = File::Spec->catfile($docroot, 'index.html');
    } else {
      print $client "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
      close $client; next;
    }
  }

  my ($ext) = $abs =~ /\.([a-z0-9]+)$/i;
  my $ct = $MIME{ lc($ext // '') } // 'application/octet-stream';

  open my $fh, '<:raw', $abs or do {
    print $client "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n";
    close $client; next;
  };
  local $/; my $body = <$fh>; close $fh;

  print $client "HTTP/1.1 200 OK\r\n";
  print $client "Content-Type: $ct\r\n";
  print $client "Content-Length: " . length($body) . "\r\n";
  print $client "Cache-Control: no-store, no-cache, must-revalidate\r\n";
  print $client "Pragma: no-cache\r\n";
  print $client "Access-Control-Allow-Origin: *\r\n";
  print $client "\r\n";
  print $client $body;
  close $client;
}
