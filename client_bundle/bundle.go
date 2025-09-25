package client_bundle

// Files in this folder are generated as part of the build process (except this one)
// The sole purpose of this file is to embed these generated client files into the server binary

import "embed"

//go:embed base_fs/*
//go:embed client/*
var BundledFiles embed.FS
